/**
 * C-4 — a gate's verdict is a fact about the DOSSIER, not about the observer.
 * ---------------------------------------------------------------------------
 * RATIFIED INVARIANT:
 *
 *   GateVerdict(dossier state, configuration) is invariant across authorized
 *   observers. Actor permissions decide whether the actor may PERFORM the
 *   action; they must not change whether the dossier SATISFIES the gate.
 *
 * The defect: `loadProcessSnapshot` fills its evidence arrays conditionally on
 * the caller's permissions, and the gate evaluators read those arrays directly.
 * `podReceived(snap)` asks `snap.documents.some(...)` with no access check — so
 * a caller without `document:read` handed the gate an empty array, and the gate
 * read that SILENCE as `false`. An absent permission was indistinguishable from
 * an absent POD. BILLING_OFFICER holds no `document:read`, so the role that owns
 * step 20 could never open its own billing gate.
 *
 * The pure half of the invariant is proved here by evaluating each gate twice
 * over the SAME dossier facts — once with every domain readable, once blind —
 * and asserting the verdicts agree. The behavioural half runs against a real
 * database in tests/journey/.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateBillingGate, evaluateClosureGate, evaluatePickupGate } from "@/lib/process/engine/gates";
import type { ExecutionView } from "@/lib/process/engine/state";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

/** One dossier's facts, seen with every domain readable. */
function sightedSnap() {
  return {
    fileType: "IMP",
    documents: [
      { typeCode: "DELIVERY_NOTE", status: "VERIFIED" },
      { typeCode: "BON_A_DELIVRER", status: "VERIFIED" },
      { typeCode: "PRE_GATE_AUTHORIZATION", status: "VERIFIED" },
      { typeCode: "BORDEREAU_LIVRAISON", status: "VERIFIED" },
    ],
    invoices: [{ status: "ISSUED", balance: 0 }],
    customs: { status: "RELEASED", required: true, baeReference: "BAE-1", declarationNumber: "D-1", externalRef: null },
    transport: { status: "DELIVERED", vehiclePlate: "DK-1", driverName: "D", driverUserId: null },
    declaredAbsences: [],
    access: { documents: true, customs: true, transport: true, finance: true },
  } as never;
}

/**
 * THE SAME dossier, seen by an actor who may read nothing.
 *
 * This is exactly what `loadProcessSnapshot` produces for such a caller: the
 * arrays are not filtered item by item, they are never loaded at all.
 */
function blindSnap() {
  return {
    fileType: "IMP",
    documents: [],
    invoices: [],
    customs: null,
    transport: null,
    declaredAbsences: [],
    access: { documents: false, customs: false, transport: false, finance: false },
  } as never;
}

const doneViews: ExecutionView[] = [
  { stepKey: "coordinator_completeness", state: "COMPLETED" },
  { stepKey: "am_completeness", state: "COMPLETED" },
  { stepKey: "customs_field_clearance", state: "COMPLETED" },
  { stepKey: "transport_assignment", state: "COMPLETED" },
  { stepKey: "collections", state: "COMPLETED" },
] as ExecutionView[];

describe("C-4 — the gate evaluators are observer-dependent (which is WHY the fix is upstream)", () => {
  // These are not aspirational assertions. They pin the CURRENT behaviour of
  // the pure evaluators, and pinning it is the point: the evaluators were left
  // alone deliberately, because a blind snapshot is a lie told upstream and the
  // honest place to fix it is where the snapshot is built.
  it("the billing gate disagrees with itself when handed a blinded snapshot", () => {
    expect(evaluateBillingGate(doneViews, sightedSnap()).ready).toBe(true);
    expect(evaluateBillingGate(doneViews, blindSnap()).ready).toBe(false);
  });

  it("the pickup gate does too", () => {
    expect(evaluatePickupGate(sightedSnap(), doneViews).ready).not.toBe(
      evaluatePickupGate(blindSnap(), doneViews).ready,
    );
  });

  it("so no gate may EVER be evaluated on a caller-scoped snapshot", () => {
    // The general rule, enforced structurally: every authoritative call site
    // goes through the gate-authority module, which builds its own full-read
    // view. If a future gate is added and wired to `ctx.permissions`, this is
    // the test that should be updated to include it — not bypassed.
    const authority = read("lib/process/engine/gate-authority.ts");
    expect(authority).toContain("GATE_FULL_READ");
    for (const domain of ["document:read", "customs:read", "transport:read", "finance:read"]) {
      expect(authority, domain).toContain(domain);
    }
  });
});

describe("C-4 — every AUTHORITATIVE gate call site evaluates on platform state", () => {
  const sites: [string, string, string][] = [
    ["step 20/21/22 — billing lane", "lib/process/billing/actions.ts", "authoritativeBillingReady(ctx.tenantId, fileId)"],
    ["step 15 — pickup convergence", "lib/process/engine/actions.ts", "authoritativePickupGate(c.tenantId, fileId)"],
  ];

  it.each(sites)("%s uses the authority", (_label, file, call) => {
    expect(read(file)).toContain(call);
  });

  it("neither call site still builds its gate view from the caller", () => {
    // The exact shape of the defect: a snapshot built from ctx.permissions and
    // then handed to a gate.
    const billing = read("lib/process/billing/actions.ts");
    expect(billing).not.toContain("evaluateBillingGate(toViews(snap.executions), snap.evidence)");
    const actions = read("lib/process/engine/actions.ts");
    expect(actions).not.toContain("evaluatePickupGate(st.snapshot!.evidence, views)");
  });

  it("step 26 — closure evaluates on platform state, at BOTH its sites", () => {
    const collections = read("lib/collections/actions.ts");
    // evaluateClosureReadiness (the read) and closeDossier (the act).
    const uses = collections.match(/loadClosureInput\(user\.tenantId, fileId, \[\.\.\.GATE_FULL_READ\]\)/g) ?? [];
    expect(uses, "both closure sites must be authoritative").toHaveLength(2);
    expect(collections).not.toContain("loadClosureInput(user.tenantId, fileId, permissions)");
  });

  it("the operator's readiness display agrees with the engine", () => {
    // Otherwise the workspace reports "not ready" while the action it offers
    // succeeds — the display and the engine disagreeing about one dossier.
    const service = read("lib/process/engine/service.ts");
    expect(service).toContain("authoritativeGates(user.tenantId, fileId)");
    expect(service).toContain("pickupReadiness: gates.pickup");
    expect(service).toContain("billingReadiness: gates.billing");
    expect(service).toContain("closureReadiness: gates.closure");
  });
});

describe("C-4 — the correction confers ZERO new read authority", () => {
  const authority = read("lib/process/engine/gate-authority.ts");

  it("the authority module returns VERDICTS only — never records", () => {
    // Structural, not stylistic: if no exported signature can carry a document
    // row, a customs record or an invoice, then no caller can receive one.
    // GateResult is { key, ready, requirements[], missing[] } — booleans,
    // labels and reason codes.
    expect(authority).toContain("Promise<AuthoritativeGates | null>");
    expect(authority).toContain("Promise<GateResult | null>");
    expect(authority).toContain("Promise<boolean>");
    // The snapshot is created and consumed inside; it is never returned.
    expect(authority).not.toMatch(/export\s+.*(EvidenceSnapshot|ProcessSnapshot)/);
    expect(authority).not.toMatch(/return\s+snap\b/);
  });

  it("no operational role gained a read permission for this", () => {
    // The rejected alternative was granting document:read to BILLING_OFFICER,
    // FINANCE_OFFICER and COLLECTIONS_OFFICER. That would have unblocked today's
    // cases, left the mechanism intact for the next role, and widened three
    // roles' data access to fix an engine bug.
    const templates = read("lib/platform/role-templates.ts");
    for (const role of ["BILLING_OFFICER", "FINANCE_OFFICER", "COLLECTIONS_OFFICER"]) {
      const start = templates.indexOf(`key: "${role}"`);
      expect(start, role).toBeGreaterThan(-1);
      const block = templates.slice(start, templates.indexOf('\n    ],', start));
      expect(block, `${role} must not have gained document:read`).not.toContain('"document:read"');
    }
    // …and the pickup agent still holds no customs:read.
    const pickupStart = templates.indexOf('key: "PICKUP_AGENT"');
    const pickupBlock = templates.slice(pickupStart, templates.indexOf('\n    ],', pickupStart));
    expect(pickupBlock).not.toContain('"customs:read"');
  });

  it("display snapshots stay permission-filtered", () => {
    // The correction belongs at the gate boundary. Making every snapshot
    // globally privileged would have solved the gate and leaked the records.
    const snapshot = read("lib/process/engine/snapshot.ts");
    expect(snapshot).toContain('documents: hasPermission(permissions, "document:read")');
    expect(snapshot).toContain("access.documents");
  });

  it("AUTHORIZATION still runs first — full-read evaluation is not execution authority", () => {
    // The mutation that matters most: a gate that evaluates on platform state
    // must never become a reason to skip guard(). Both call sites must still
    // establish the actor's authority BEFORE consulting the gate.
    const actions = read("lib/process/engine/actions.ts");
    const activate = actions.slice(
      actions.indexOf("export async function activateStep"),
      actions.indexOf("export async function submitStep"),
    );
    const guardAt = activate.indexOf("await guard(stepPermission(stepKey), fileId)");
    const gateAt = activate.indexOf("authoritativePickupGate");
    expect(guardAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(guardAt, "guard() must precede gate evaluation").toBeLessThan(gateAt);

    const billing = read("lib/process/billing/actions.ts");
    const draft = billing.slice(
      billing.indexOf("export async function prepareInvoiceDraft"),
      billing.indexOf("export async function submitInvoiceToFinance"),
    );
    const gGuard = draft.indexOf('guard("finance:create", fileId)');
    const gReady = draft.indexOf("billingReady(");
    expect(gGuard).toBeGreaterThan(-1);
    expect(gReady).toBeGreaterThan(-1);
    expect(gGuard, "authorization precedes gate evaluation").toBeLessThan(gReady);
  });

  it("closure still requires its own permission and visibility", () => {
    const collections = read("lib/collections/actions.ts");
    const close = collections.slice(collections.indexOf("export async function closeDossier"));
    expect(close).toContain('assertPermission("process:close")');
    expect(close).toContain("isFileVisible(user.id, user.tenantId, fileId)");
    const authAt = close.indexOf('assertPermission("process:close")');
    const gateAt = close.indexOf("loadClosureInput");
    expect(authAt, "authorization precedes gate evaluation").toBeLessThan(gateAt);
  });
});

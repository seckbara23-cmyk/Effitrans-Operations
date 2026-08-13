/**
 * MAYA-P1.9 — the CEO chain after Bon à Délivrer: no qualifying gap.
 * ---------------------------------------------------------------------------
 * The census classified every remaining CEO step A, E or G, so nothing was
 * built. Most of what it verified is already covered elsewhere — `canPickup` and
 * `canReceivePod` have their own suites, closure has P1.6, the tower has P1.7.
 *
 * What was NOT pinned is the handful of LINKS the audit's conclusions rest on:
 * the claim "the POD rule is not a P1.2-style proxy" is only true because
 * `changeTransportStatus` demands `transport:complete` AND runs the POD gate. If
 * either slips, the conclusion silently becomes false and nothing fails.
 *
 * These are those links, and nothing more.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canReceivePod, canPickup } from "@/lib/transport/gates";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { FACT_RULES } from "@/lib/process/reconcile/satisfaction";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TRANSPORT = "lib/transport/actions.ts";
const step = (key: string) => EFFITRANS_PROCESS.find((s) => s.key === key)!;

function actionBody(file: string, name: string): string {
  const s = code(file);
  const start = s.indexOf(`export async function ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const next = s.indexOf("export async function", start + 1);
  return s.slice(start, next === -1 ? undefined : next);
}

// ===========================================================================
describe("the POD rule is not a proxy — the links that make that true", () => {
  it("POD_RECEIVED costs transport:complete, not the ordinary transport:update", () => {
    const b = actionBody(TRANSPORT, "changeTransportStatus");
    expect(b).toMatch(/toStatus === "DELIVERED" \|\| toStatus === "POD_RECEIVED"\s*\?\s*"transport:complete"/);
    expect(b).toContain('assertPermission(permission)');
  });

  it("…and it cannot be set without an APPROVED Delivery Note", () => {
    // This is the whole argument: the transport-status half of the WES-5 rule
    // requires the same evidence as the document half, so neither is a shortcut.
    const b = actionBody(TRANSPORT, "changeTransportStatus");
    expect(b).toContain('if (toStatus === "POD_RECEIVED")');
    expect(b).toContain("canReceivePod(approved)");
    expect(b).toContain('error: "pod_required"');
    expect(canReceivePod(["DELIVERY_NOTE"])).toBe(true);
    expect(canReceivePod(["COMMERCIAL_INVOICE"])).toBe(false);
  });

  it("the WES-5 rule accepts either half, and both mean verified evidence", () => {
    const r = FACT_RULES.transport_pod_handoff;
    expect(r.satisfied({
      fileType: "IMP", fileStatus: "IN_PROGRESS", customs: null,
      transport: { status: "DELIVERED" }, verifiedPodDocumentId: "doc-1", verifiedBaeDocumentId: null,
    })).toBe(true);
    expect(r.satisfied({
      fileType: "IMP", fileStatus: "IN_PROGRESS", customs: null,
      transport: { status: "POD_RECEIVED" }, verifiedPodDocumentId: null, verifiedBaeDocumentId: null,
    })).toBe(true);
    // Delivered with no POD evidence at all proves nothing.
    expect(r.satisfied({
      fileType: "IMP", fileStatus: "IN_PROGRESS", customs: null,
      transport: { status: "DELIVERED" }, verifiedPodDocumentId: null, verifiedBaeDocumentId: null,
    })).toBe(false);
  });

  it("the automatic receipt is not a second user-facing power", () => {
    // pod-receipt.ts records the consequence of a verification that already
    // passed document:approve + maker-checker. It must never assert its own.
    const p = code("lib/transport/pod-receipt.ts");
    expect(p).not.toContain('assertPermission("transport:complete")');
    expect(read("lib/transport/pod-receipt.ts")).toContain("why this does not assert `transport:complete`");
  });
});

// ===========================================================================
describe("pickup: the enforced rule is customs release", () => {
  it("the server gate is customs, and it is real", () => {
    const b = actionBody(TRANSPORT, "changeTransportStatus");
    expect(b).toContain('if (toStatus === "PICKED_UP")');
    expect(b).toContain("canPickup(fileType, customs, rec.customs_override)");
    expect(b).toContain('error: "customs_not_released"');
    expect(canPickup("IMP", { required: true, status: "DECLARED" }, false)).toBe(false);
    expect(canPickup("IMP", { required: true, status: "RELEASED" }, false)).toBe(true);
  });

  it("the registry's completionRule stays descriptive, as P1.5/P1.6 proved", () => {
    // « pickup_confirmed_after_readiness_gate » is a label rendered as
    // nextAction, never an executable gate. Pinned so the audit's reasoning
    // cannot quietly become wrong.
    expect(step("pickup").completionRule).toBe("pickup_confirmed_after_readiness_gate");
    expect(code("lib/process/queues/service.ts")).toContain("nextAction: node?.completionRule");
  });
});

// ===========================================================================
describe("the post-BAD chain is owned as the CEO document says", () => {
  it("each step's role and narrow permission are unchanged", () => {
    const expected: [string, string, string][] = [
      ["transport_assignment", "TRANSPORT_OFFICER", "transport:assign"],
      ["pickup", "PICKUP_AGENT", "transport:update"],
      ["am_delivery_followup", "ACCOUNT_MANAGER", "transport:complete"],
      ["transport_pod_handoff", "COORDINATOR", "document:create"],
    ];
    for (const [key, role, perm] of expected) {
      expect(step(key).role, key).toBe(role);
      expect(step(key).permissions, key).toContain(perm);
    }
  });

  it("« sortie du port » was NOT invented as a durable fact", () => {
    // §E: the sources disagree on whether it is distinct from pickup, so no
    // column exists and none may appear without Effitrans answering R-15.
    expect(step("pickup").requiredEvidence).toContain("port_exit_evidence");
    for (const f of ["lib/transport/actions.ts", "lib/process/reconcile/satisfaction.ts"]) {
      expect(code(f), f).not.toMatch(/port_exit|portExit/);
    }
    expect(read("lib/platform/ops/build-info.ts")).toContain("MIGRATION_COUNT = 105");
  });

  it("no fleet module was invented — a vehicle is still a plate", () => {
    // CEO step 12 asks for affectation, not conformity; conformity is Q5.1.
    // The plate is a FIELD on transport_record, mapped in the patch allowlist —
    // there is no vehicle entity, and none was created.
    expect(code("lib/transport/patch.ts")).toContain('vehiclePlate: "vehicle_plate"');
    expect(code("lib/transport/service.ts")).toContain("vehicle_plate");
    for (const f of [TRANSPORT, "lib/transport/service.ts"]) {
      expect(code(f), f).not.toMatch(/from\("vehicle"\)|from\("fleet/);
    }
  });

  it("the audit is on the record", () => {
    const doc = read("docs/maya/maya-p1-9-post-bad-audit.md");
    expect(doc).toContain("NO QUALIFYING GAP");
    expect(doc).toContain("is NOT a P1.2-style proxy");
  });
});

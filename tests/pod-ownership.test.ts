/**
 * UAT-1 — POD ownership moves from Transport to Operations.
 *
 * Business rule: most drivers here are subcontractors who hand the signed BL to
 * the office after the run. Transport's responsibility ends at DELIVERED;
 * Operations obtains and verifies the delivery proof; the platform records the
 * receipt automatically so nobody clicks twice for a fact already established.
 *
 * These tests pin the ownership, the automatic transition contract and its
 * idempotency, and the scope boundaries (no driver upload, no GPS, no new
 * department/role/permission/table).
 */
import { canonicalWorkflowInput, type CanonicalWorkflowInput } from "@/lib/workflow/canonical-input";
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getDossierLifecycle, type LifecycleInput } from "@/lib/files/lifecycle";
import { buildCanonicalProjection } from "@/lib/workflow/projection";
import { canonicalDepartmentForLifecycle } from "@/lib/workflow/access/departments";
import { isVerified } from "@/lib/documents/doctrine";
import { canReceivePod } from "@/lib/transport/gates";
import { getNode } from "@/lib/process/engine/state";
import { funnelStage, bottlenecks } from "@/lib/control-tower/aggregate";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RECEIPT = "lib/transport/pod-receipt.ts";
const DOC_ACTIONS = "lib/documents/actions.ts";

const mk = (over: Partial<CanonicalWorkflowInput> = {}): CanonicalWorkflowInput => canonicalWorkflowInput({
  fileId: "f1",
  file: { status: "DELIVERED", type: "IMP" },
  documents: [{ status: "APPROVED" }],
  missingRequired: [],
  customs: { status: "RELEASED", required: true },
  transport: { status: "DELIVERED" },
  invoices: [],
  podApproved: false,
  ...over,
});

const stageOf = (lc: ReturnType<typeof getDossierLifecycle>, key: string) =>
  lc.steps.find((s) => s.key === key)?.status;

// ---------------------------------------------------------------------------
describe("responsibility after delivery", () => {
  it("DELIVERED with no verified POD → responsible department is OPERATIONS", () => {
    const lc = getDossierLifecycle(canonicalWorkflowInput(mk()));
    expect(lc.currentStep).toBe("delivery_proof");
    expect(lc.currentDepartment).toBe("documentation");
    expect(canonicalDepartmentForLifecycle("documentation")).toBe("OPERATIONS");
  });

  it("FINANCE is NOT responsible while the POD is missing", () => {
    const lc = getDossierLifecycle(canonicalWorkflowInput(mk()));
    expect(lc.currentDepartment).not.toBe("finance");
    expect(stageOf(lc, "invoiced")).toBe("pending");
  });

  it("the await_pod gate no longer sits on the finance stage", () => {
    const lc = getDossierLifecycle(canonicalWorkflowInput(mk()));
    expect(lc.nextAction?.reasonCode).toBe("upload_delivery_proof");
    expect(lc.nextAction?.reasonCode).not.toBe("await_pod");
    expect(code("lib/files/lifecycle.ts")).not.toContain('gateCode: !input.podApproved ? "await_pod"');
  });

  it("FINANCE becomes responsible only after POD verification", () => {
    const lc = getDossierLifecycle(canonicalWorkflowInput(mk({ transport: { status: "POD_RECEIVED" }, podApproved: true })));
    expect(stageOf(lc, "delivery_proof")).toBe("completed");
    expect(lc.currentDepartment).toBe("finance");
  });

  it("the canonical projection agrees — one projection, not a second opinion", () => {
    const before = buildCanonicalProjection(canonicalWorkflowInput(mk()));
    const after = buildCanonicalProjection(canonicalWorkflowInput(mk({ transport: { status: "POD_RECEIVED" }, podApproved: true })));
    expect(before?.responsibleDepartment).toBe("documentation");
    expect(after?.responsibleDepartment).toBe("finance");
  });

  it("follows the transport leg's applicability exactly", () => {
    // `transportApplicable = !transportCancelled`, so the delivery-proof stage
    // inherits the same rule as every other transport stage — no new notion of
    // applicability is introduced.
    const cancelled = getDossierLifecycle(canonicalWorkflowInput(mk({ transport: { status: "CANCELLED" } })));
    expect(stageOf(cancelled, "delivery_proof")).toBe(stageOf(cancelled, "delivered"));
    expect(stageOf(cancelled, "delivery_proof")).toBe("skipped");

    const live = getDossierLifecycle(canonicalWorkflowInput(mk({ transport: { status: "IN_TRANSIT" } })));
    expect(stageOf(live, "delivery_proof")).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
describe("process step 17 ownership", () => {
  it("transport_pod_handoff belongs to coordination / COORDINATOR", () => {
    const node = getNode("transport_pod_handoff");
    expect(node?.department).toBe("coordination");
    expect(node?.role).toBe("COORDINATOR");
  });

  it("no unrelated step changed hands", () => {
    expect(getNode("transport_assignment")?.department).toBe("transport");
    expect(getNode("pickup")?.department).toBe("pickup");
    expect(getNode("am_delivery_followup")?.department).toBe("account_management");
    expect(getNode("coordinator_completeness")?.department).toBe("coordination");
  });
});

// ---------------------------------------------------------------------------
describe("automatic POD receipt", () => {
  const src = () => code(RECEIPT);

  it("fires only for a verified DELIVERY_NOTE", () => {
    expect(code(DOC_ACTIONS)).toMatch(/if \(doc\.type_code === "DELIVERY_NOTE"\) \{[\s\S]{0,200}recordPodReceiptFromVerifiedEvidence/);
  });

  it("an unrelated document type does not advance transport", () => {
    // The call site is guarded by type; nothing else invokes the receipt.
    const callers = code(DOC_ACTIONS).match(/recordPodReceiptFromVerifiedEvidence/g) ?? [];
    expect(callers.length).toBe(2); // the import + the single guarded call
  });

  it("advances ONLY from DELIVERED", () => {
    const b = src();
    expect(b).toMatch(/if \(transport\.status === "POD_RECEIVED"\) return "already";/);
    expect(b).toMatch(/if \(transport\.status !== "DELIVERED"\) return "not_delivered";/);
  });

  it("re-applies the SAME evidence gate — it does not bypass it", () => {
    const b = src();
    expect(b).toContain("isVerified(d.status");
    expect(b).toContain("canReceivePod(verifiedCodes)");
    expect(b).toContain('return "evidence_missing"');
  });

  it("transitions by compare-and-set, so concurrent verifications produce one move", () => {
    expect(src()).toMatch(/\.eq\("status", "DELIVERED"\)/);
    expect(src()).toMatch(/if \(\(moved\?\.length \?\? 0\) !== 1\) return "already";/);
  });

  it("runs the EXISTING finance handoff, not a new one", () => {
    const b = src();
    expect(b).toContain("onPodReceived(supabase, ctx, fileId)");
    expect(b).not.toMatch(/\.from\("process_handoff"\)[\s\S]{0,120}\.insert\(/);
    expect(b).not.toMatch(/\.from\("task"\)[\s\S]{0,120}\.insert\(/);
  });

  it("triggers WES-5 reconciliation", () => {
    expect(src()).toContain("reconcileDossierProcess");
  });

  it("never throws — a receipt failure cannot roll back the verification", () => {
    expect(src()).toMatch(/\} catch \{\s*\n\s*return "failed";/);
  });

  it("records provenance honestly — never as a Transport click", () => {
    expect(src()).toContain('source: "AUTOMATIC_ON_POD_VERIFICATION"');
  });

  it("emits no business event of its own — the DB trigger owns that", () => {
    expect(src()).not.toContain("emit_business_event");
    expect(src()).not.toContain("business_event");
  });
});

// ---------------------------------------------------------------------------
describe("evidence doctrine is unchanged", () => {
  it("VERIFIED, legacy APPROVED and CONSUMED_AS_EVIDENCE all remain proof", () => {
    for (const s of ["VERIFIED", "APPROVED", "CONSUMED_AS_EVIDENCE"]) {
      expect(isVerified(s), s).toBe(true);
      expect(canReceivePod(["DELIVERY_NOTE"].filter(() => isVerified(s)))).toBe(true);
    }
  });

  it("rejected, expired and superseded PODs never advance transport", () => {
    for (const s of ["REJECTED", "EXPIRED", "SUPERSEDED", "UPLOADED", "PENDING_REVIEW"]) {
      expect(isVerified(s), s).toBe(false);
      expect(canReceivePod(["DELIVERY_NOTE"].filter(() => isVerified(s)))).toBe(false);
    }
  });

  it("DELIVERY_NOTE stays transport-stage evidence — the WES-5C trap", () => {
    // Making it documentation-stage would re-block the documentation stage from
    // the day a dossier opens, the exact defect WES-5C removed.
    expect(read("lib/documents/doctrine.ts")).toMatch(/code: "DELIVERY_NOTE",[\s\S]{0,160}earliestStage: "transport"/);
  });
});

// ---------------------------------------------------------------------------
describe("UI ownership", () => {
  it("Transport no longer instructs anyone to chase the POD", () => {
    const p = code("components/transport/transport-panel.tsx");
    expect(p).not.toContain("tr.podMissing");
    expect(p).toContain("Preuve de livraison gérée par les Opérations");
  });

  it("the manual POD_RECEIVED button is withdrawn, the STATE is not", () => {
    expect(code("components/transport/transport-panel.tsx")).toContain('if (s === "POD_RECEIVED") return null;');
    // the transport model keeps the state and its transition
    expect(code("lib/transport/status.ts")).toContain("POD_RECEIVED");
    expect(code("lib/transport/status.ts")).toContain('DELIVERED: ["POD_RECEIVED"');
  });

  it("the delivery-proof panel reuses the document pipeline — no second system", () => {
    const p = code("components/transport/delivery-proof-panel.tsx");
    expect(p).toContain("isVerified");
    // no upload/review action of its own
    expect(p).not.toContain("uploadDocument");
    expect(p).not.toContain("approveDocument");
    expect(p).not.toContain("<form");
  });

  it("the panel is hidden before delivery", () => {
    expect(code("components/transport/delivery-proof-panel.tsx"))
      .toMatch(/if \(rank !== "DELIVERED" && rank !== "POD_RECEIVED"\) return null;/);
  });

  it("Finance displays the POD read-only and can never upload or verify it", () => {
    const f = code("components/finance/finance-panel.tsx");
    expect(f).toContain("podVerified");
    expect(f).not.toContain("uploadDocument");
    expect(f).not.toContain("approveDocument");
  });
});

// ---------------------------------------------------------------------------
describe("control tower follows the new stage", () => {
  it("a dossier awaiting its POD is not counted as archived", () => {
    expect(funnelStage("delivery_proof", "DELIVERED")).toBe("delivered");
  });

  it("awaiting_pod counts the delivery_proof stage", () => {
    const rows = [
      { lifecycle: { currentStep: "delivery_proof", blockers: [], nextAction: null }, overdueInvoice: false },
      { lifecycle: { currentStep: "invoiced", blockers: [], nextAction: null }, overdueInvoice: false },
    ] as unknown as Parameters<typeof bottlenecks>[0];
    const byKey = Object.fromEntries(bottlenecks(rows).map((b) => [b.key, b.count]));
    expect(byKey.awaiting_pod).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("scope boundaries", () => {
  it("the driver portal is untouched", () => {
    const driver = code("lib/driver/actions.ts");
    expect(driver).not.toContain("DELIVERY_NOTE");
    expect(driver).not.toContain("document");
    expect(driver).not.toContain("POD_RECEIVED\",");
    // its exports remain the four GPS-session controls
    for (const fn of ["startMission", "pauseTracking", "resumeTracking", "stopMission"]) {
      expect(driver).toContain(`export async function ${fn}`);
    }
  });

  it("adds no GPS or tracking feature", () => {
    const all = code(RECEIPT) + code("components/transport/delivery-proof-panel.tsx");
    expect(all).not.toMatch(/tracking_session|geofence|gps|position/i);
  });

  it("adds no department, role, permission, table or engine", () => {
    const all = code(RECEIPT) + code("components/transport/delivery-proof-panel.tsx") + code("lib/files/lifecycle.ts");
    expect(all).not.toContain("assertPermission");
    expect(all).not.toMatch(/create table|alter table/i);
    // the canonical department vocabulary is unchanged
    expect(code("lib/workflow/access/departments.ts")).toContain('customs: "TRANSIT"');
    expect(code("lib/workflow/access/departments.ts")).toContain('documentation: "OPERATIONS"');
  });

  it("ships no migration", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => /pod|delivery_proof/i.test(f))).toEqual([]);
  });

  it("starts no WES-6 or WES-8 work", () => {
    const all = code(RECEIPT) + code("components/transport/delivery-proof-panel.tsx");
    expect(all).not.toMatch(/\bsla\b|\bmission\b/i);
  });
});

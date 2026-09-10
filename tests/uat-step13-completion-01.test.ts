/**
 * STEP13-COMPLETION-01 — step 13 may not close on a BAE reference alone.
 * ---------------------------------------------------------------------------
 * THE DEFECT, as it stood on EFT-IMP-2026-00011. The field agent started step
 * 13 and recorded BAE-UAT-EFT-00011. The Chef de Transit's verification was
 * PENDING, customs was still INSPECTION — and « Terminer » was offered, and
 * `submitStep` would have accepted it.
 *
 * The registry has always declared `completionRule:
 * "bae_obtained_and_customs_released"`. Only the first half was enforced:
 * step 13's sole required key was `BON_A_ENLEVER`, which asks whether a BAE
 * REFERENCE exists. So the moment the reference landed, the evidence was
 * "complete".
 *
 * And the early completion would not have been merely premature. `customs.
 * release` is gated on this very step; a COMPLETED step answers `step_closed`;
 * so `finalizeTransitRelease` could never record the release, customs could
 * never become RELEASED, and the pickup gate could never open. Reconciliation
 * would only report CONFLICT — it never regresses a completion.
 *
 * THE REPAIR: one structured key, `CUSTOMS_RELEASE`, satisfied ONLY by
 * `customs_record.status === "RELEASED"`. `BON_A_ENLEVER` keeps its meaning.
 * Nothing about who records, verifies or releases has changed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateStepEvidence, type EvidenceSnapshot } from "@/lib/process/engine/evidence";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import { blockingRequirements, governanceFor } from "@/lib/process/requirement-class";
import { contextualStatus } from "@/lib/process/contextual/view";
import { DOCUMENT_MAPPINGS } from "@/lib/process/documents";
import { getStep } from "@/lib/process/effitrans-process";
import { CONTROL_OWNING_STEP, evaluateControlGate } from "@/lib/process/control-gate";
import {
  ASSIGNMENT_OWNED_STEPS,
  RELEASE_APPROVAL_ROLES,
  mayApproveRelease,
} from "@/lib/process/handoff-routes";
import { FACT_RULES, evaluateStep } from "@/lib/process/reconcile/satisfaction";
import { prerequisitesMet } from "@/lib/process/engine/state";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const S13 = "customs_field_clearance";
const AGENT = "u-agterrain";
const CHEF = "u-chef-transit";

/** AGTerrainDemo's real permission set, as probed in production. */
const AGENT_VIEWER = {
  userId: AGENT,
  permissions: ["customs:read", "customs:release", "customs:update", "document:read", "process:read", "transport:read"],
  roles: ["CUSTOMS_FIELD_AGENT", "PICKUP_AGENT"],
};

type Customs = {
  status: string;
  baeReference: string | null;
  /** Carried only to make each case self-describing; the evidence never reads it. */
  releaseApprovalStatus: "PENDING" | "REJECTED" | "APPROVED" | null;
};

const snap = (c: Customs, customsReadable = true): EvidenceSnapshot => ({
  fileType: "IMP",
  fieldAgentAssignedUserId: AGENT,
  access: { documents: true, customs: customsReadable, transport: true, finance: false },
  documents: [],
  customs: {
    required: true,
    status: c.status,
    baeReference: c.baeReference,
    declarationNumber: "UAT-00011",
    externalRef: "UAT-GAINDE-DECL-00011",
    attachmentCompletedAt: "2026-09-09T21:38:13Z",
  },
  transport: null,
  invoices: [],
} as unknown as EvidenceSnapshot);

const requirementsFrom = (s: EvidenceSnapshot) =>
  evaluateStepEvidence(S13, s).items
    .filter((i) => i.status !== "satisfied")
    .map((i) => ({ key: i.key, labelFr: i.labelFr, status: i.status as "missing" }));

const activeStep13 = (s: EvidenceSnapshot, over: Partial<StepActionFacts> = {}): StepActionFacts => ({
  stepKey: S13, state: "ACTIVE", assignedUserId: AGENT, custody: "not_applicable",
  owningRole: "CUSTOMS_FIELD_AGENT", missingPrerequisites: [], requirements: requirementsFrom(s),
  notApplicable: null, ...over,
});

/**
 * THE SERVER'S VERDICT, derived exactly as `submitStep` derives it: unauthorized
 * evidence refuses, then any blocking requirement refuses with
 * `evidence_missing`. The source pins below prove `submitStep` asks precisely
 * these two questions, from these two functions, in this order.
 */
function serverWouldComplete(s: EvidenceSnapshot): { ok: boolean; error?: string } {
  const ev = evaluateStepEvidence(S13, s);
  if (ev.unauthorized.length > 0) return { ok: false, error: "evidence_unauthorized" };
  if (blockingRequirements(S13, ev).length > 0) return { ok: false, error: "evidence_missing" };
  return { ok: true };
}

const CASES: { name: string; c: Customs; completable: boolean }[] = [
  { name: "no BAE, INSPECTION", c: { status: "INSPECTION", baeReference: null, releaseApprovalStatus: null }, completable: false },
  { name: "BAE, approval PENDING, INSPECTION", c: { status: "INSPECTION", baeReference: "BAE-UAT-EFT-00011", releaseApprovalStatus: "PENDING" }, completable: false },
  { name: "BAE, approval REJECTED, INSPECTION", c: { status: "INSPECTION", baeReference: "BAE-UAT-EFT-00011", releaseApprovalStatus: "REJECTED" }, completable: false },
  { name: "BAE, approval APPROVED, INSPECTION (not finalized)", c: { status: "INSPECTION", baeReference: "BAE-UAT-EFT-00011", releaseApprovalStatus: "APPROVED" }, completable: false },
  { name: "BAE, RELEASED", c: { status: "RELEASED", baeReference: "BAE-UAT-EFT-00011", releaseApprovalStatus: "APPROVED" }, completable: true },
];

// ===========================================================================
describe("the requirement — two facts, two keys", () => {
  it("step 13 requires the BAE AND the release, BAE first", () => {
    expect(getStep(S13)!.requiredDocuments).toEqual(["BON_A_ENLEVER", "CUSTOMS_RELEASE"]);
    expect(getStep(S13)!.completionRule).toBe("bae_obtained_and_customs_released");
  });

  it("CUSTOMS_RELEASE is structured, never an upload, and HARD", () => {
    const m = DOCUMENT_MAPPINGS.find((d) => d.key === "CUSTOMS_RELEASE")!;
    expect(m).toMatchObject({ labelFr: "Mainlevée finalisée", typeCode: null, status: "structured", steps: [S13] });
    expect(governanceFor(S13, "CUSTOMS_RELEASE")).toMatchObject({ klass: "HARD_GATE", ratified: true });
    expect(governanceFor(S13, "BON_A_ENLEVER")).toMatchObject({ klass: "HARD_GATE", ratified: true });
  });

  it("BON_A_ENLEVER was NOT redefined — it is still the BAE reference", () => {
    const ev = evaluateStepEvidence(S13, snap({ status: "INSPECTION", baeReference: "BAE-X", releaseApprovalStatus: "PENDING" }));
    expect(ev.items.find((i) => i.key === "BON_A_ENLEVER")!.status).toBe("satisfied");
    expect(ev.items.find((i) => i.key === "CUSTOMS_RELEASE")!.status).toBe("missing");
  });

  it("only RELEASED satisfies it — no other status, whatever the approval says", () => {
    for (const status of ["NOT_STARTED", "DOCUMENTS_PENDING", "DECLARATION_PREPARED", "DECLARED",
      "UNDER_REVIEW", "INSPECTION", "DUTIES_ASSESSED", "BLOCKED", "CANCELLED"]) {
      const ev = evaluateStepEvidence(S13, snap({ status, baeReference: "BAE-X", releaseApprovalStatus: "APPROVED" }));
      expect(ev.items.find((i) => i.key === "CUSTOMS_RELEASE")!.status, status).toBe("missing");
    }
  });

  it("it respects the existing evidence-access model", () => {
    const ev = evaluateStepEvidence(S13, snap({ status: "RELEASED", baeReference: "BAE-X", releaseApprovalStatus: "APPROVED" }, false));
    expect(ev.items.find((i) => i.key === "CUSTOMS_RELEASE")!.status).toBe("unauthorized");
    expect(serverWouldComplete(snap({ status: "RELEASED", baeReference: "BAE-X", releaseApprovalStatus: "APPROVED" }, false)))
      .toEqual({ ok: false, error: "evidence_unauthorized" });
  });
});

// ===========================================================================
describe("the completion gate, state by state — UI and server agree", () => {
  for (const k of CASES) {
    it(`ACTIVE + ${k.name} → ${k.completable ? "completable" : "REFUSED"}`, () => {
      const s = snap(k.c);
      const ui = evaluateStepAction(activeStep13(s), AGENT_VIEWER);
      const server = serverWouldComplete(s);

      expect(ui.canSubmit, "UI « Terminer »").toBe(k.completable);
      expect(server.ok, "server submitStep").toBe(k.completable);
      if (!k.completable) expect(server.error).toBe("evidence_missing");
      // THE PARITY: the button and the server can never hold two opinions.
      expect(ui.canSubmit).toBe(server.ok);
    });
  }

  it("the operator is told the right thing at each stage", () => {
    const before = evaluateStepAction(activeStep13(snap(CASES[0].c)), AGENT_VIEWER);
    expect(before.reasonFr).toBe("Action requise : Bon à Enlever (BAE).");

    for (const k of CASES.slice(1, 4)) {
      const after = evaluateStepAction(activeStep13(snap(k.c)), AGENT_VIEWER);
      expect(after.reasonFr, k.name).toBe("Action requise : Mainlevée finalisée.");
      expect(contextualStatus("ACTIVE", after).key, k.name).not.toBe("a_votre_tour");
    }
    const released = evaluateStepAction(activeStep13(snap(CASES[4].c)), AGENT_VIEWER);
    expect(released.reasonFr).toBeNull();
  });

  it("the START gate is untouched — step 13 is startable with neither fact", () => {
    for (const k of CASES.slice(0, 2)) {
      const s = snap(k.c);
      const el = evaluateStepAction(activeStep13(s, { state: "AVAILABLE" }), AGENT_VIEWER);
      expect(el.canStart, k.name).toBe(true);
    }
    expect(prerequisitesMet(S13, [{ stepKey: "customs_followup", state: "COMPLETED" }])).toBe(true);
  });

  it("submitStep derives its verdict from exactly these functions", () => {
    const engine = code("lib/process/engine/actions.ts");
    const fn = engine.slice(engine.indexOf("export async function submitStep"), engine.indexOf("export async function completeStep"));
    expect(fn).toContain("evaluateStepEvidence(stepKey, st.snapshot!.evidence)");
    expect(fn).toMatch(/if \(ev\.unauthorized\.length > 0\) \{\s*return fail\("evidence_unauthorized"\)/);
    expect(fn).toMatch(/if \(blockingRequirements\(stepKey, ev\)\.length > 0\)/);
    expect(fn).toContain('failWithEvidence("evidence_missing", ev)');
    expect(fn.indexOf("ev.unauthorized.length")).toBeLessThan(fn.indexOf("blockingRequirements(stepKey, ev)"));
  });
});

// ===========================================================================
describe("reconciliation still closes step 13 after the release", () => {
  it("the fact rule and the evidence agree, before and after RELEASED", () => {
    for (const k of CASES) {
      const evidenceComplete = evaluateStepEvidence(S13, snap(k.c)).complete;
      const factSatisfied = FACT_RULES[S13].satisfied({ customs: { status: k.c.status } } as never);
      expect(evidenceComplete, k.name).toBe(factSatisfied);
    }
  });

  it("after RELEASED the reconciler sees SATISFIED on an ACTIVE step", () => {
    const v = evaluateStep({
      stepKey: S13,
      facts: { fileType: "IMP", fileStatus: "OPENED", customs: { status: "RELEASED", required: true, baeReference: "BAE-X" }, transport: null } as never,
      execution: { stepKey: S13, state: "ACTIVE" },
    });
    expect(v.satisfaction).toBe("SATISFIED");
  });

  it("the release action still triggers that convergence", () => {
    const customs = code("lib/customs/actions.ts");
    const fn = customs.slice(customs.indexOf("export async function recordCustomsRelease"), customs.indexOf("export async function recordCustomsReleaseApproval"));
    expect(fn).toContain('cause: "customs_release"');
    expect(fn).toContain("reconcileDossierProcess");
  });
});

// ===========================================================================
describe("the release control and the maker/checker chain are intact", () => {
  it("the release control stays usable while step 13 is ACTIVE, for its claimant", () => {
    expect(CONTROL_OWNING_STEP["customs.release"]).toBe(S13);
    expect(CONTROL_OWNING_STEP["customs.bae"]).toBe(S13);
    expect(evaluateControlGate({ hasInstance: true, step: { state: "ACTIVE", assignedUserId: AGENT }, userId: AGENT }))
      .toEqual({ allowed: true, reason: "step_open" });
  });

  it("…and the Chef cannot perform the field agent's finalization", () => {
    expect(evaluateControlGate({ hasInstance: true, step: { state: "ACTIVE", assignedUserId: AGENT }, userId: CHEF }))
      .toEqual({ allowed: false, reason: "assigned_to_another" });
  });

  it("only the Chef de Transit verifies, and the recorder may not verify their own BAE", () => {
    expect(RELEASE_APPROVAL_ROLES).toEqual(["CHIEF_OF_TRANSIT"]);
    expect(mayApproveRelease(["CUSTOMS_FIELD_AGENT", "PICKUP_AGENT"])).toBe(false);
    expect(mayApproveRelease(["OPS_SUPERVISOR"])).toBe(false);
    expect(mayApproveRelease(["CHIEF_OF_TRANSIT"])).toBe(true);
    const transit = code("lib/process/engine/transit-actions.ts");
    const decide = transit.slice(transit.indexOf("export async function decideTransitRelease"), transit.indexOf("export async function finalizeTransitRelease"));
    expect(decide).toContain('if (!mayApproveRelease(ctx.roles)) return fail("not_authorized_approver")');
    expect(decide).toContain('if (res.error === "self_approval_forbidden") return fail("self_validation_forbidden")');
    // …and the database refuses the recorder on the recorded author, where no
    // second permission can reach around it.
    const migration = read("supabase/migrations/20260930000001_customs_release_approval.sql");
    expect(migration).toContain("self_approval_forbidden: the actor who recorded the BAE may not approve it");
  });

  it("the release still refuses without the Chef's APPROVED verdict", () => {
    const customs = code("lib/customs/actions.ts");
    const fn = customs.slice(customs.indexOf("export async function recordCustomsRelease"), customs.indexOf("export async function recordCustomsReleaseApproval"));
    expect(fn).toMatch(/rec\.release_approval_status !== "APPROVED"/);
    const transit = code("lib/process/engine/transit-actions.ts");
    const finalize = transit.slice(transit.indexOf("export async function finalizeTransitRelease"), transit.indexOf("export async function dispatchToField"));
    expect(finalize).toContain('return fail("release_not_approved")');
  });

  it("another field agent cannot take the assigned step 13", () => {
    expect(ASSIGNMENT_OWNED_STEPS.has(S13)).toBe(true);
    const s = snap(CASES[1].c);
    const other = evaluateStepAction(activeStep13(s), { ...AGENT_VIEWER, userId: "u-other-agent" });
    expect(other.claimedByAnother).toBe(true);
    expect(other.canSubmit).toBe(false);
  });

  it("none of the three acts was touched by this repair", () => {
    // The repair lives entirely in the evidence model: no writer imports it,
    // and the evidence module imports no writer.
    const evidence = read("lib/process/engine/evidence.ts");
    expect(evidence).not.toMatch(/getAdminSupabaseClient|"use server"|\.update\(|\.insert\(|writeAudit/);
  });
});

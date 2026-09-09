/**
 * UAT-STEP12-FIELD-AGENT-01 — the step's own output, finally required.
 * ---------------------------------------------------------------------------
 * THE DEFECT, as it stood on EFT-IMP-2026-00011. Step 12 is « Coordinateur —
 * suivre le dossier en douane ET affecter l'Agent de Terrain », and the
 * registry had always declared exactly that: `requiredEvidence:
 * ["field_agent_id"]`, `completionRule: "field_agent_assigned"`.
 *
 * Nothing enforced it. `evaluateStepEvidence` reads `requiredDocuments`, which
 * was `[]`, so « Terminer » would have closed step 12 with nobody named and
 * opened step 13 with `assigned_user_id` NULL — the governed responsibility of
 * the step silently skippable, and step 13's ownership established by whoever
 * happened to claim it.
 *
 * And the mechanism was never missing. `assignTransitStep` already accepted
 * `customs_field_clearance`, already admitted the Coordinator (no
 * ASSIGNMENT_AUTHORITY entry ⇒ any `customs:assign` holder), already checked
 * Transit custody and assignee eligibility, and already audited before AND
 * after. It had no door: the only caller passed `customs_preparation`.
 *
 * So this slice cut the door (J1) and made the declared contract real (J2).
 * NO new writer, NO new permission, NO ASSIGNMENT_AUTHORITY change, and the
 * enforcement is narrow — `requiredEvidence` stays documentary for the other
 * 25 steps, because turning it into a gate everywhere is exactly what the
 * leniency doctrine warns against.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateStepEvidence, type EvidenceSnapshot } from "@/lib/process/engine/evidence";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import { blockingRequirements, governanceFor } from "@/lib/process/requirement-class";
import { DOCUMENT_MAPPINGS } from "@/lib/process/documents";
import { getStep } from "@/lib/process/effitrans-process";
import { prerequisitesMet } from "@/lib/process/engine/state";
import { ASSIGNMENT_AUTHORITY, ASSIGNMENT_OWNED_STEPS, mayAssignStep } from "@/lib/process/handoff-routes";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { deriveTransitStages } from "@/lib/process/transit";
import { FACT_RULES } from "@/lib/process/reconcile/satisfaction";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const S12 = "customs_followup";
const S13 = "customs_field_clearance";
const transitActions = code("lib/process/engine/transit-actions.ts");
const panel = code("components/process/transit-panel.tsx");
const processPage = code("app/files/[id]/process/page.tsx");

const AGENT = "u-field-agent";
const COORD = {
  userId: "u-coordinator",
  permissions: ["customs:update", "customs:assign", "process:read"],
  roles: ["ACCOUNT_MANAGER", "COORDINATOR"],
};

const snap = (fieldAgentAssignedUserId: string | null): EvidenceSnapshot => ({
  fileType: "IMP",
  fieldAgentAssignedUserId,
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [],
  customs: {
    required: true, status: "INSPECTION", baeReference: null,
    declarationNumber: "UAT-00011", externalRef: "UAT-GAINDE-DECL-00011",
    attachmentCompletedAt: "2026-09-09T21:38:13.479Z",
  },
  transport: null,
  invoices: [],
} as unknown as EvidenceSnapshot);

const requirementsFrom = (s: EvidenceSnapshot) =>
  evaluateStepEvidence(S12, s).items
    .filter((i) => i.status !== "satisfied")
    .map((i) => ({ key: i.key, labelFr: i.labelFr, status: i.status as "missing" }));

const step12Facts = (over: Partial<StepActionFacts> = {}): StepActionFacts => ({
  stepKey: S12, state: "ACTIVE", assignedUserId: COORD.userId,
  custody: "not_applicable", owningRole: "COORDINATOR",
  missingPrerequisites: [], requirements: [], notApplicable: null,
  ...over,
});

/** `assignTransitStep`'s body — the one writer, bounded. */
function writer(): string {
  const i = transitActions.indexOf("export async function assignTransitStep");
  expect(i, "assignTransitStep must exist").toBeGreaterThan(-1);
  return transitActions.slice(i, transitActions.indexOf("export async function", i + 1));
}

// ===========================================================================
describe("1/2 — who may assign, and who may not", () => {
  it("1 — the Coordinator may assign the Field Agent on step 13", () => {
    expect(ASSIGNMENT_AUTHORITY[S13], "no narrowing entry ⇒ any customs:assign holder").toBeUndefined();
    expect(mayAssignStep(S13, ["COORDINATOR"])).toBe(true);
    expect(mayAssignStep(S13, ["ACCOUNT_MANAGER", "COORDINATOR"])).toBe(true);
    const coordinator = TENANT_ROLE_TEMPLATES.find((t) => t.key === "COORDINATOR")!;
    expect(coordinator.permissions).toContain("customs:assign");
    expect(writer()).toContain('transitGuard("customs:assign", fileId)');
  });

  it("2 — a role without customs:assign cannot, and no role was widened", () => {
    for (const role of ["CUSTOMS_DECLARANT", "CUSTOMS_FIELD_AGENT", "TRANSPORT_OFFICER", "BILLING_OFFICER"]) {
      const t = TENANT_ROLE_TEMPLATES.find((x) => x.key === role);
      if (t) expect(t.permissions, role).not.toContain("customs:assign");
    }
    // …and the Déclarant assignment stays the Chef's, untouched.
    expect(ASSIGNMENT_AUTHORITY["transit_declarant_assignment"])
      .toEqual(["CHIEF_OF_TRANSIT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]);
    expect(mayAssignStep("transit_declarant_assignment", ["COORDINATOR"])).toBe(false);
  });
});

// ===========================================================================
describe("3/4/5 — who may be assigned", () => {
  const w = writer();

  it("3 — cross-tenant is refused, on the assignee's own tenant_id", () => {
    expect(w).toMatch(/staff\.tenant_id !== ctx\.tenantId/);
    expect(w).toContain('return fail("not_found")');
  });

  it("4 — an inactive user is refused", () => {
    expect(w).toMatch(/staff\.status !== "active"/);
  });

  it("5 — a user outside the TRANSIT department is refused", () => {
    expect(w).toMatch(/roleCanonicalDepartment\(r\.code\) === "TRANSIT"/);
    expect(w).toMatch(/if \(!isTransit\) return fail\("forbidden"\)/);
    // The step must also be one the platform allows to be assigned at all.
    expect(transitActions).toMatch(/ASSIGNABLE_STEP_KEYS\.has\(stepKey\)/);
    expect(transitActions).toContain('"customs_field_clearance"');
    // …and Transit must actually hold the dossier.
    expect(w).toMatch(/transitCustody\(admin, ctx\.tenantId, instance\.id\)/);
  });
});

// ===========================================================================
describe("6/7/13 — the assignment is audited, governed and idempotent", () => {
  const w = writer();

  it("6 — the audit records BEFORE and AFTER", () => {
    expect(w).toContain("AuditActions.PROCESS_STEP_ASSIGNED");
    expect(w).toMatch(/before: \{ step_key: stepKey, assigned_user_id:/);
    expect(w).toMatch(/after: \{ step_key: stepKey, assigned_user_id: userId \}/);
  });

  it("7 — reassignment goes through the same writer, and both holders are recorded", () => {
    // There is no separate reassign path: the same call with a new userId, and
    // the audit above names who lost the work as well as who gained it.
    expect(transitActions.match(/PROCESS_STEP_ASSIGNED/g) ?? []).toHaveLength(1);
  });

  it("13 — one writer, one column, CAS — no duplicate assignment or event", () => {
    expect(w).toMatch(/\.update\(\{ assigned_user_id: userId \}\)/);
    expect(w, "CAS on the observed state").toMatch(/\.eq\("state", exec\.state\)/);
    expect(w).not.toMatch(/\.insert\(/);
    // The UI never writes the row itself.
    expect(panel).not.toMatch(/process_step_execution/);
    expect(panel).toContain('assignTransitStep(fileId, "customs_field_clearance", fieldAgentId)');
  });

  it("…and there is exactly ONE assignment writer in the platform", () => {
    // No other module names a DIFFERENT person on an execution row.
    for (const f of [
      "lib/process/engine/actions.ts",
      "lib/process/engine/intake-actions.ts",
      "lib/process/engine/structures-actions.ts",
    ]) {
      const src = code(f);
      // `activateStep` legitimately claims a step for its own caller; nothing
      // else may name a DIFFERENT person.
      expect(src, f).not.toMatch(/assigned_user_id: userId/);
    }
  });
});

// ===========================================================================
describe("8/9 — step 12 cannot complete without the assignment", () => {
  it("8 — no Field Agent ⇒ the evidence is missing, HARD, and completion refused", () => {
    const ev = evaluateStepEvidence(S12, snap(null));
    expect(ev.complete).toBe(false);
    expect(ev.missing).toContain("FIELD_AGENT_ASSIGNMENT");
    expect(blockingRequirements(S12, ev).length).toBeGreaterThan(0);
    expect(governanceFor(S12, "FIELD_AGENT_ASSIGNMENT")).toMatchObject({ klass: "HARD_GATE", ratified: true });

    const el = evaluateStepAction(step12Facts({ requirements: requirementsFrom(snap(null)) }), COORD);
    expect(el.canSubmit, "« Terminer » must be refused").toBe(false);
    expect(el.reasonFr).toContain("Agent de Terrain");
  });

  it("9 — with a valid assignment, step 12 may complete", () => {
    const ev = evaluateStepEvidence(S12, snap(AGENT));
    expect(ev.complete).toBe(true);
    expect(ev.satisfied).toContain("FIELD_AGENT_ASSIGNMENT");
    expect(blockingRequirements(S12, ev)).toEqual([]);

    const el = evaluateStepAction(step12Facts({ requirements: requirementsFrom(snap(AGENT)) }), COORD);
    expect(el.canSubmit).toBe(true);
    expect(el.reasonFr).toBeNull();
  });

  it("the requirement is STRUCTURED — never an upload, and no new document type", () => {
    const mapping = DOCUMENT_MAPPINGS.find((d) => d.key === "FIELD_AGENT_ASSIGNMENT")!;
    expect(mapping.status).toBe("structured");
    expect(mapping.typeCode).toBeNull();
    expect(mapping.steps).toEqual([S12]);
    // A document upload can never satisfy it — the branch answers first.
    const withDocs = { ...snap(null), documents: [{ typeCode: "GAINDE_SUBMISSION_EVIDENCE", status: "VERIFIED" }] };
    expect(evaluateStepEvidence(S12, withDocs as unknown as EvidenceSnapshot).complete).toBe(false);
  });

  it("and the registry now declares it where the evaluator actually looks", () => {
    expect(getStep(S12)!.requiredDocuments).toEqual(["FIELD_AGENT_ASSIGNMENT"]);
    expect(getStep(S12)!.completionRule).toBe("field_agent_assigned");
  });
});

// ===========================================================================
describe("10/11/12 — step 13's ownership", () => {
  it("10 — step 13 opens only once step 12 is COMPLETED", () => {
    expect(getStep(S13)!.prerequisites).toEqual([S12]);
    for (const s12 of ["ACTIVE", "AVAILABLE", "PENDING"] as const) {
      expect(prerequisitesMet(S13, [{ stepKey: S12, state: s12 }]), s12).toBe(false);
    }
    expect(prerequisitesMet(S13, [{ stepKey: S12, state: "COMPLETED" }])).toBe(true);
  });

  it("11 — the assignment survives the completion: it is on step 13's own row", () => {
    // `assignTransitStep` writes step 13; `submitStep` on step 12 touches only
    // step 12 and promotes. Nothing clears the assignee.
    expect(writer()).toMatch(/\.eq\("step_key", stepKey\)/);
    const engine = code("lib/process/engine/actions.ts");
    expect(engine, "promotion never reassigns").not.toMatch(/state: "AVAILABLE", assigned_user_id/);
    expect(code("lib/process/engine/promote.ts")).not.toMatch(/assigned_user_id:/);
  });

  it("12 — another Field Agent cannot take an assigned step 13", () => {
    expect(ASSIGNMENT_OWNED_STEPS.has(S13), "assignment-owned ⇒ the claim bites in ANY state").toBe(true);
    const el = evaluateStepAction(
      {
        stepKey: S13, state: "AVAILABLE", assignedUserId: AGENT,
        custody: "not_applicable", owningRole: "CUSTOMS_FIELD_AGENT",
        missingPrerequisites: [], requirements: [], notApplicable: null,
      },
      { userId: "u-other-agent", permissions: ["customs:release"], roles: ["CUSTOMS_FIELD_AGENT"] },
    );
    expect(el.claimedByAnother).toBe(true);
    expect(el.canStart).toBe(false);
    // …and its own assignee is not blocked.
    const mine = evaluateStepAction(
      {
        stepKey: S13, state: "AVAILABLE", assignedUserId: AGENT,
        custody: "not_applicable", owningRole: "CUSTOMS_FIELD_AGENT",
        missingPrerequisites: [], requirements: [], notApplicable: null,
      },
      { userId: AGENT, permissions: ["customs:release"], roles: ["CUSTOMS_FIELD_AGENT"] },
    );
    expect(mine.claimedByAnother).toBe(false);
  });
});

// ===========================================================================
describe("14 — T9 is still the transport branch, and never this", () => {
  it("T9 maps to official step 14 alone", () => {
    const t9 = deriveTransitStages([{ stepKey: "transport_assignment", state: "AVAILABLE" }], [])
      .find((s) => s.key === "T9")!;
    expect(t9.stepKeys).toEqual(["transport_assignment"]);
    expect(t9.stepKeys).not.toContain(S12);
    expect(t9.stepKeys).not.toContain(S13);
  });

  it("its dispatch writes a TEAM CODE on step 14, never a person on step 13", () => {
    const i = transitActions.indexOf("export async function dispatchToField");
    const body = transitActions.slice(i, transitActions.indexOf("export async function", i + 1));
    expect(body).toContain('transitGuard("process:team:manage", fileId)');
    expect(body).not.toContain("assigned_user_id");
    expect(body).not.toContain(S13);
  });

  it("the two controls are distinct in the UI, and the field-agent one says so", () => {
    expect(panel).toContain('assignTransitStep(fileId, "customs_field_clearance", fieldAgentId)');
    expect(panel).toContain("dispatchToField(fileId)");
    expect(panel).toContain("Agent de Terrain (douane)");
  });
});

// ===========================================================================
describe("15/16/17/18 — nothing else moved", () => {
  it("15 — steps 6–11 keep their own requirements", () => {
    expect(getStep("customs_preparation")!.requiredDocuments).toEqual(["CUSTOMS_DOSSIER"]);
    expect(getStep("transit_validation")!.requiredDocuments).toEqual(["CUSTOMS_DOSSIER"]);
    expect(getStep("gainde_registration")!.requiredDocuments).toEqual([]);
    expect(getStep("coordinator_to_declarant")!.requiredDocuments).toEqual([]);
    expect(getStep("gainde_document_submission")!.requiredDocuments).toEqual(["GAINDE_SUBMISSION_EVIDENCE"]);
    expect(FACT_RULES["gainde_document_submission"]).toBeTruthy();
  });

  it("16 — leniency holds: BAD and Pre-Gate are not step-12 blockers", () => {
    const prereqs = getStep(S12)!.prerequisites as readonly string[];
    for (const k of ["transport_assignment", "pickup", "billing_draft", S13]) {
      expect(prereqs, k).not.toContain(k);
    }
    // And step 12's requirement set is exactly one thing: its own output.
    expect(evaluateStepEvidence(S12, snap(AGENT)).items.map((i) => i.key))
      .toEqual(["FIELD_AGENT_ASSIGNMENT"]);
  });

  it("17 — the transport branch is untouched", () => {
    expect(getStep("transport_assignment")!.prerequisites).not.toContain(S12);
    expect(getStep("transport_assignment")!.requiredDocuments).not.toContain("FIELD_AGENT_ASSIGNMENT");
  });

  it("18 — step 15 convergence is untouched", () => {
    const pickup = getStep("pickup")!;
    expect(pickup.prerequisites).toContain(S13);
    expect(pickup.prerequisites).toContain("transport_assignment");
    expect(pickup.requiredDocuments).not.toContain("FIELD_AGENT_ASSIGNMENT");
  });

  it("the enforcement is NARROW — requiredEvidence stays documentary elsewhere", () => {
    // Only two steps carry a structured non-upload requirement, and both were
    // ratified individually. Nothing wired `requiredEvidence` generically.
    const structured = DOCUMENT_MAPPINGS.filter((d) => d.typeCode === null).map((d) => d.key);
    expect(structured.sort()).toEqual(
      ["ACCOUNT_MANAGER_ASSIGNMENT", "CUSTOMS_DOSSIER", "FIELD_AGENT_ASSIGNMENT", "FINAL_INVOICE"].sort(),
    );
    expect(code("lib/process/engine/evidence.ts")).not.toMatch(/node\?\.requiredEvidence/);
  });
});

// ===========================================================================
describe("the surface exposes the act, and the governed fact", () => {
  it("the page asks the EXISTING reader for eligible agents, only when unassigned", () => {
    expect(processPage).toContain('listEligibleTransitAssignees("CUSTOMS_FIELD_AGENT")');
    expect(processPage).toMatch(/canAssignTransit && !transit\.fieldAgent/);
    expect(processPage).toContain("eligibleFieldAgents={eligibleFieldAgents}");
  });

  it("the panel shows who, by whom and when — from the execution row and its audit", () => {
    expect(panel).toContain("state.fieldAgent.name");
    expect(panel).toContain("state.fieldAgent.assignedByName");
    expect(panel).toContain("state.fieldAgent.assignedAt");
    // Read from the assignment audit, not from a second business fact.
    expect(transitActions).toMatch(/\.eq\("action", "process\.step\.assigned"\)/);
    expect(transitActions).toMatch(/step_key === "customs_field_clearance"/);
  });

  it("the stale registry note no longer claims the role and mechanism are missing", () => {
    const impl = JSON.stringify(getStep(S12)!.implementation);
    expect(impl).not.toContain("no CUSTOMS_FIELD_AGENT role");
    expect(impl).not.toContain("no field-agent assignment");
    expect(impl).toContain("assignTransitStep");
  });
});

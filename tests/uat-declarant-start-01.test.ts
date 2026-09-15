/**
 * UAT-DECLARANT-START-01 — naming the Déclarant is the step, not a note beside it.
 * ---------------------------------------------------------------------------
 * EFT-IMP-2026-00012, diagnosed read-only 2026-09-15. The Chef de Transit
 * assigned Rokhaya Assane DIOP to the customs preparation on 09-10. Official
 * step 5 — whose ratified completion rule IS that assignment — stayed AVAILABLE,
 * so step 6 was never promoted, and for five days the assigned Déclarant opened
 * the dossier to a « Démarrer » she could not press and a « Créer le dossier
 * douane » that answered « Cette étape n'est pas encore ouverte. »
 *
 * Nothing was wrong with her: one account, one tenant, role CUSTOMS_DECLARANT,
 * `customs:create` held, claimant id equal to her app_user id equal to her auth
 * id. Nothing was wrong with the evaluators either — every surface refused for
 * the true reason. The act was half-finished, and this file keeps it whole:
 *
 *   1. the two pure rules (who the Déclarant is, and that step 5 needs one);
 *   2. the engine: step 5 refuses to close empty, and the assignment closes it
 *      through the engine's own doors;
 *   3. reassignment: future authority only, idempotent, audited old → new;
 *   4. the panel: the Chef can see AND change the Déclarant;
 *   5. the boundaries: no third assignment path, no migration, no new grant.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DECLARANT_ASSIGNMENT_STEP,
  DECLARANT_PREPARATION_STEP,
  declarantOf,
  declarantRequiredRefusal,
} from "@/lib/process/declarant-assignment";
import { evaluateStepAction } from "@/lib/process/step-eligibility";
import { buildStepFacts } from "@/lib/process/contextual/build";
import { PROCESS_ERROR_FR, processErrorFr } from "@/lib/process/error-fr";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import type { ExecutionView } from "@/lib/process/engine/state";
import type { StepEvidence } from "@/lib/process/engine/evidence";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, "utf8").replace(/\r\n/g, "\n");
/** Source without comments: prose may mention a call, code may not. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s+\/\/ .*$/gm, "");
/** A function body, from its declaration to the next top-level one. */
function fn(src: string, name: string): string {
  const start = src.search(new RegExp(`^(export )?async function ${name}\\(`, "m"));
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/^(export )?async function |^\/\*\*/m);
  return rest.slice(0, next < 0 ? undefined : next);
}

const TRANSIT = code("lib/process/engine/transit-actions.ts");
const ENGINE = code("lib/process/engine/actions.ts");
const PANEL = code("components/process/transit-panel.tsx");

// ===========================================================================
describe("the two pure rules", () => {
  const rows = (assignee: string | null, state = "AVAILABLE") => [
    { stepKey: "coordinator_reception", state: "COMPLETED" },
    { stepKey: DECLARANT_ASSIGNMENT_STEP, state: "ACTIVE" },
    { stepKey: DECLARANT_PREPARATION_STEP, state, assignedUserId: assignee },
  ];

  it("the Déclarant IS the assignee of the live preparation row", () => {
    expect(declarantOf(rows("u-1"))).toBe("u-1");
    expect(declarantOf(rows(null))).toBeNull();
    expect(declarantOf(rows("   ")), "whitespace is nobody").toBeNull();
    expect(declarantOf([]), "no row is nobody").toBeNull();
  });

  it("a rejected or cancelled attempt is history, never the live row", () => {
    const corrected = [
      { stepKey: DECLARANT_PREPARATION_STEP, state: "REJECTED", assignedUserId: "old" },
      { stepKey: DECLARANT_PREPARATION_STEP, state: "AVAILABLE", assignedUserId: "new" },
    ];
    expect(declarantOf(corrected)).toBe("new");
    expect(declarantOf([{ stepKey: DECLARANT_PREPARATION_STEP, state: "CANCELLED", assignedUserId: "old" }])).toBeNull();
  });

  it("step 5 may not close with nobody named — and no other step is asked", () => {
    expect(declarantRequiredRefusal(DECLARANT_ASSIGNMENT_STEP, rows(null))).toBe("declarant_required");
    expect(declarantRequiredRefusal(DECLARANT_ASSIGNMENT_STEP, rows("u-1"))).toBeNull();
    for (const other of ["coordinator_reception", DECLARANT_PREPARATION_STEP, "transit_validation", "pickup"]) {
      expect(declarantRequiredRefusal(other, rows(null)), other).toBeNull();
    }
  });

  it("the registry says this is step 5's product — the rule is not invented here", () => {
    const step5 = EFFITRANS_PROCESS.find((s) => s.key === DECLARANT_ASSIGNMENT_STEP)!;
    const step6 = EFFITRANS_PROCESS.find((s) => s.key === DECLARANT_PREPARATION_STEP)!;
    expect(step5.completionRule).toBe("declarant_assigned");
    expect(step6.prerequisites).toContain(DECLARANT_ASSIGNMENT_STEP);
    expect(step6.role, "step 6 stays the Déclarant's").toBe("CUSTOMS_DECLARANT");
  });
});

// ===========================================================================
describe("the engine — step 5 refuses to close empty", () => {
  it("submitStep asks the shared rule, after applicability and before evidence", () => {
    const body = fn(ENGINE, "submitStep");
    expect(body).toContain("const declarant = declarantRequiredRefusal(stepKey, st.snapshot!.executions);");
    expect(body).toContain("if (declarant) return fail(declarant);");
    expect(ENGINE).toContain('import { declarantRequiredRefusal } from "../declarant-assignment";');
    // Order is the message an operator reads: out of scope outranks it, and a
    // missing person is not a missing document.
    expect(body.indexOf("stepApplicability(stepKey, scope)")).toBeLessThan(body.indexOf("declarantRequiredRefusal"));
    expect(body.indexOf("declarantRequiredRefusal")).toBeLessThan(body.indexOf("evaluateStepEvidence"));
    // No second spelling of the rule anywhere in the engine.
    expect(ENGINE.match(/declarantRequiredRefusal/g)).toHaveLength(2); // import + call
    expect(ENGINE).not.toContain('=== "transit_declarant_assignment"');
  });

  it("the refusal is a named code with its own sentence", () => {
    expect(read("lib/process/engine/types.ts")).toContain('| "declarant_required"');
    expect(PROCESS_ERROR_FR.declarant_required).toBeTruthy();
    expect(processErrorFr("declarant_required")).toContain("Affectez d'abord un Déclarant");
    // It says what to DO. A person is wanted, not a document.
    expect(processErrorFr("declarant_required")).not.toMatch(/document|pièce|preuve/i);
  });

  it("an unassigned dossier cannot reach step 6 at all", () => {
    // The « unassigned cannot start » case is answered at step 5's door, which
    // is the only place it can be answered without touching the ratified rule
    // that an OPEN, UNCLAIMED step belongs to its owning ROLE
    // (OPS-CUSTOMS-OWNERSHIP-01). Step 6 simply never opens.
    const views: ExecutionView[] = [
      { stepKey: "coordinator_reception", state: "COMPLETED" },
      { stepKey: DECLARANT_ASSIGNMENT_STEP, state: "ACTIVE" },
      { stepKey: DECLARANT_PREPARATION_STEP, state: "PENDING" },
    ];
    expect(declarantRequiredRefusal(DECLARANT_ASSIGNMENT_STEP, views)).toBe("declarant_required");
    const facts = buildStepFacts({
      stepKey: DECLARANT_PREPARATION_STEP,
      state: "PENDING",
      assignedUserId: null,
      handoffs: [],
      views,
      evidence: EMPTY_EVIDENCE,
      owningRole: "CUSTOMS_DECLARANT",
    });
    const el = evaluateStepAction(facts, {
      userId: "any-declarant",
      permissions: ["customs:create", "customs:update"],
      roles: ["CUSTOMS_DECLARANT"],
    });
    expect(el.canStart, "nobody starts a step the assignment never opened").toBe(false);
    expect(facts.missingPrerequisites).toContain(DECLARANT_ASSIGNMENT_STEP);
  });
});

const EMPTY_EVIDENCE: StepEvidence = {
  items: [], satisfied: [], missing: [], invalid: [], pendingReview: [], unauthorized: [], complete: true,
};

// ===========================================================================
describe("the assignment completes step 5 — through the engine, never around it", () => {
  const closer = fn(TRANSIT, "closeDeclarantAssignmentStep");
  const assign = fn(TRANSIT, "assignTransitStep");

  it("it uses the existing doors, so every guard still answers for itself", () => {
    expect(closer).toContain("await activateStep(fileId, DECLARANT_ASSIGNMENT_STEP)");
    expect(closer).toContain("await submitStep(fileId, DECLARANT_ASSIGNMENT_STEP)");
    // NOT a state write of its own: that would bypass custody, ownership,
    // evidence, promotion and the audit trail in one line.
    expect(closer).not.toMatch(/\.update\(\s*\{\s*state/);
    expect(closer).not.toContain("promoteSuccessors");
    expect(closer).not.toContain("cas(");
  });

  it("it is idempotent, and only ever walks the engine's own ladder", () => {
    expect(closer).toContain("if (isDone(row.state as StepState)) return null;");
    expect(closer).toContain('if (row.state === "AVAILABLE")');
    expect(closer).toContain('} else if (row.state !== "ACTIVE") {');
    expect(closer).toContain('return "invalid_state"');
  });

  it("only the Déclarant's step triggers it — step 13 assignment is untouched", () => {
    expect(assign).toContain("if (stepKey === DECLARANT_PREPARATION_STEP) {");
    expect(assign).toContain("await closeDeclarantAssignmentStep(admin, ctx, fileId, instance.id);");
    expect(assign).not.toContain("customs_field_clearance");
  });

  it("and it runs only after the assignment actually landed", () => {
    expect(assign.indexOf('.update({ assigned_user_id: userId })'))
      .toBeLessThan(assign.indexOf("closeDeclarantAssignmentStep"));
    // The guards that were already there are all still there, ahead of both.
    for (const guard of [
      'transitGuard("customs:assign", fileId)',
      'if (!mayAssignStep(stepKey, ctx.roles)) return fail("not_authorized_assigner")',
      "transitCustody(admin, ctx.tenantId, instance.id)",
      'roleCanonicalDepartment(r.code) === "TRANSIT"',
    ]) {
      expect(assign, guard).toContain(guard);
      expect(assign.indexOf(guard), `${guard} precedes the write`)
        .toBeLessThan(assign.indexOf(".update({ assigned_user_id: userId })"));
    }
  });
});

// ===========================================================================
describe("reassignment — future authority only", () => {
  const assign = fn(TRANSIT, "assignTransitStep");

  it("naming the same person writes nothing and notifies nobody", () => {
    expect(assign).toContain("const unchanged = previous === userId;");
    const guarded = assign.slice(assign.indexOf("if (!unchanged) {"), assign.indexOf("if (stepKey === DECLARANT_PREPARATION_STEP)"));
    for (const effect of [".update({ assigned_user_id: userId })", "writeAudit", "createNotification"]) {
      expect(guarded, `${effect} happens only on a real change`).toContain(effect);
    }
    // …and the convergence is OUTSIDE that block: re-assigning the same person
    // is how a dossier stranded by the old behaviour is repaired.
    expect(assign.indexOf("closeDeclarantAssignmentStep")).toBeGreaterThan(assign.indexOf("if (!unchanged) {"));
    expect(assign.slice(assign.indexOf("closeDeclarantAssignmentStep"))).not.toContain("unchanged");
  });

  it("one column is written, so no history can be rewritten", () => {
    const updates = assign.match(/\.update\(\{[^}]*\}\)/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toBe(".update({ assigned_user_id: userId })");
    for (const historical of ["started_at", "submitted_by", "completed_at", "reviewed_by", "state:"]) {
      expect(updates[0], historical).not.toContain(historical);
    }
  });

  it("a reassignment stays possible while the work is ACTIVE", () => {
    // The live-row filter excludes only terminal states; ACTIVE is workable
    // work and is exactly when an absence has to be covered.
    expect(assign).toContain('.not("state", "in", "(REJECTED,CANCELLED,COMPLETED,SKIPPED)")');
  });

  it("the trail records the dossier and both sides of the move", () => {
    expect(assign).toContain("action: AuditActions.PROCESS_STEP_ASSIGNED");
    const before = assign.slice(assign.indexOf("before: {"), assign.indexOf("after: {"));
    const after = assign.slice(assign.indexOf("after: {"), assign.indexOf("});", assign.indexOf("after: {")));
    expect(before).toContain("assigned_user_id: previous");
    expect(before).toContain("file_id: fileId");
    expect(after).toContain("assigned_user_id: userId");
    expect(after).toContain("file_id: fileId");
    expect(assign).toContain("actorId: ctx.userId");
  });
});

// ===========================================================================
describe("the panel — the Chef can see the Déclarant AND change them", () => {
  it("the current Déclarant is shown by name, never by id", () => {
    expect(PANEL).toContain("{state.declarant.name}");
    expect(PANEL).not.toMatch(/state\.declarant\.id/);
  });

  it("« Changer le Déclarant » is offered only to an authorized assigner", () => {
    const block = PANEL.slice(PANEL.indexOf("Déclarant en douane"), PANEL.indexOf("Agent de Terrain"));
    expect(block).toContain("Changer le Déclarant");
    expect(block).toContain("canAssign && state.declarant ? (");
    expect(block).toContain("canAssign && (state.declarant === null || changingDeclarant)");
    // A viewer who may not assign sees the name and nothing to press.
    expect(block).toContain('<p className="mt-1 text-xs text-slate-400">Non affecté.</p>');
  });

  it("confirming uses the ONE door, with the same step key as the first assignment", () => {
    const calls = PANEL.match(/assignTransitStep\(fileId, "customs_preparation", declarantId\)/g) ?? [];
    expect(calls, "one call site for assign AND reassign").toHaveLength(1);
    expect(PANEL).toContain("Confirmer le changement");
    expect(PANEL).toContain("setChangingDeclarant(false)");
  });

  it("a refused change leaves the form open — the reset runs on success only", () => {
    const run = PANEL.slice(PANEL.indexOf("function run("), PANEL.indexOf("const gate = state.paymentGate"));
    expect(run).toContain("onSuccess?.();");
    expect(run.indexOf("if (!res.ok)")).toBeLessThan(run.indexOf("onSuccess?.();"));
  });

  it("what a change does NOT do is said where the act is taken", () => {
    expect(PANEL).toContain("Le nouveau Déclarant reprend la suite du dossier.");
    expect(PANEL).toMatch(/auteurs et l&apos;historique restent inchangés/);
  });
});

// ===========================================================================
describe("boundaries", () => {
  it("no third assignment path — the dormant WES-3A writer stays dormant", () => {
    expect(TRANSIT).not.toContain("assignProcessStep");
    expect(TRANSIT).not.toContain("assign_process_step");
    expect(TRANSIT).not.toContain("assignment_event");
    // Still nobody calls it: this fix did not wake it. Scanned, not assumed.
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(`${root}${dir}`, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && p !== "lib/workflow/access/actions.ts" && /\bassignProcessStep\s*\(/.test(read(p))) {
          callers.push(p);
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(dir);
    expect(callers, "the ledger-backed writer must stay without callers").toEqual([]);
    expect(code("lib/workflow/access/actions.ts")).toContain("assign_process_step");
  });

  it("no migration, no new permission, no new role", () => {
    for (const f of [
      "lib/process/declarant-assignment.ts",
      "lib/process/engine/transit-actions.ts",
      "lib/process/engine/actions.ts",
    ]) {
      expect(read(f), f).not.toMatch(/alter table|create table|create policy|grant /i);
    }
    // The seat that assigns is the ratified one, unchanged.
    expect(read("lib/process/handoff-routes.ts")).toContain(
      'transit_declarant_assignment: ["CHIEF_OF_TRANSIT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]',
    );
    expect(TRANSIT).toContain('transitGuard("customs:assign", fileId)');
  });

  it("the C-4 journey proves the whole contract against a real database", () => {
    const journey = read("tests/journey/transit-customs.journey.ts");
    for (const claim of [
      'expect((empty as { error: string }).error).toBe("declarant_required");',
      'expect(step5?.state, "the assignment closed step 5 itself").toBe("COMPLETED");',
      'expect(hers?.canStart, `the assigned Déclarant may start: ${JSON.stringify(hers)}`).toBe(true);',
      "the Chef may hand the work to another Déclarant before it starts",
      "the Chef may still change the Déclarant while step 6 is ACTIVE — and history holds",
      'expect(after?.started_at, "when it started is not rewritten").toBe(before?.started_at);',
      'expect((refused as { error: string }).error).toBe("step_assigned_to_other");',
      'expect((await auditFor("process.step.assigned", execId)).length, "and records nothing new").toBe(rows);',
      'expect(usurped.ok, "assignment is the Chef\'s seat").toBe(false);',
    ]) {
      expect(journey, claim).toContain(claim);
    }
    // The second Déclarant is a fixture identity with the SAME seat.
    const seed = read("supabase/tests/journey_identities.sql");
    expect(seed).toContain("journey.declarant2@test.local");
    expect(seed).toContain("('00000000-0000-0000-0000-00000000aa19'::uuid, 'CUSTOMS_DECLARANT')");
    expect(seed).toContain("expected 19 identities");
  });

  it("every journey that assigns a Déclarant stopped running step 5 by hand", () => {
    for (const j of [
      "tests/journey/transit-customs.journey.ts",
      "tests/journey/delivery-completeness.journey.ts",
      "tests/journey/issuance-consequence.journey.ts",
      "tests/journey/no-deposit.journey.ts",
      "tests/journey/negative-battery.journey.ts",
    ]) {
      const src = code(j);
      expect(src, j).toContain('assignTransitStep(fileId, "customs_preparation"');
      expect(src, `${j} must not re-run step 5 after the assignment`)
        .not.toMatch(/submitStep\(fileId, "transit_declarant_assignment"\)\), "step 5"/);
      expect(src, `${j} must not runStep step 5`)
        .not.toContain('runStep(transit, "transit_declarant_assignment")');
    }
  });
});

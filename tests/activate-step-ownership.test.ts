/**
 * OPS-CUSTOMS-GAINDE-04 slice 4 — a step cannot be claimed into ownership.
 * ---------------------------------------------------------------------------
 * THE ESCALATION, and it was one click.
 *
 * OPS-CUSTOMS-OWNERSHIP-01 closed the CONTROL layer: on an open, unassigned
 * step the actor must hold that step's owning role, so a Chef de Transit no
 * longer sees the Déclarant's maker controls on the Dédouanement panel. It did
 * not close the CLAIM layer. `activateStep` asked for the step's PERMISSION and
 * never for its OWNER — and the step permissions are deliberately broad,
 * because a Chef legitimately holds `customs:update` for their own acts.
 *
 * So the Chef could press « Démarrer » on the unclaimed step 6, become its
 * `assigned_user_id` by that very act, and thereby satisfy
 * `evaluateControlOwnership`'s `assigned_to_self` branch — unlocking, on the
 * same screen, precisely the controls the ownership rule had withheld. The
 * control layer asked "is this work yours"; the claim layer let the answer be
 * manufactured.
 *
 * This is a PRECONDITION of putting a « Démarrer » button on the dossier page,
 * not a nice-to-have: that surface renders the customs panel and the step
 * actions side by side, so the escalation would be one click with no navigation
 * at all.
 *
 * FAIL-CLOSED ON PURPOSE. The 2026-09-06 leniency doctrine says business
 * completeness requirements must not become blockers by default. It exempts
 * exactly this class: process ownership is an AUTHORITY control, and authority
 * controls stay fail-closed.
 *
 * WHAT IS NOT CHANGED. An explicit, audited assignment still wins — assign the
 * step, then act — because that leaves a record of who took whose work. That is
 * the ratified escape hatch, and every journey in this repository relies on it
 * (the Chef assigns step 6 to himself before starting it).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateControlOwnership } from "@/lib/process/control-ownership";
import { CONTROL_OWNERSHIP_ERROR } from "@/lib/process/control-gate";
import { hasProcessErrorFr, processErrorFr } from "@/lib/process/error-fr";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
/** Source with comments stripped — an assertion about code must not match prose. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTIONS = "lib/process/engine/actions.ts";
const actions = code(ACTIONS);

/** `activateStep` alone — a neighbouring function must not satisfy these. */
function activateSlice(): string {
  const i = actions.indexOf("export async function activateStep");
  expect(i, "activateStep not found").toBeGreaterThan(-1);
  const rest = actions.slice(i);
  const j = rest.indexOf("\nexport ", 1);
  const slice = j > 0 ? rest.slice(0, j) : rest;
  expect(slice.length, "activateStep slice suspiciously small").toBeGreaterThan(400);
  return slice;
}

/**
 * The guard helper alone. Bounded at the next top-level declaration rather than
 * at a brace-plus-newline: the sources here are CRLF, and a slice that silently
 * comes back empty is a pin that has stopped testing anything.
 */
function refusalSlice(): string {
  const i = actions.indexOf("async function owningRoleRefusal");
  expect(i, "owningRoleRefusal not found").toBeGreaterThan(-1);
  const rest = actions.slice(i);
  const j = rest.indexOf("export async function activateStep");
  expect(j, "owningRoleRefusal must sit just above activateStep").toBeGreaterThan(0);
  const slice = rest.slice(0, j);
  expect(slice.length, "refusal slice suspiciously small").toBeGreaterThan(300);
  return slice;
}

// ===========================================================================
// THE RULE ITSELF — one rule, not a second one
// ===========================================================================

describe("the claim layer asks the same question the control layer asks", () => {
  it("01 — it calls the shared evaluator instead of restating the rule", () => {
    // A step gate and a control gate that disagreed about ownership would be
    // worse than either alone.
    expect(refusalSlice()).toContain("evaluateControlOwnership({");
    expect(actions).toContain('import { evaluateControlOwnership } from "../control-ownership";');
  });

  it("02 — it reads the authoritative owning role, not the documentary one", () => {
    // The registry's `role` field is documentary and names roles that do not
    // exist in the tenant (DEC-C35). `process_step_owning_role` is the source.
    expect(refusalSlice()).toContain("owningRole: await stepOwningRole(stepKey)");
    expect(actions).toContain('import { stepOwningRole } from "../control-ownership-server";');
    expect(code("lib/process/control-ownership-server.ts")).toContain(
      'export async function stepOwningRole(',
    );
  });

  it("03 — the refusal is the SAME code the control gate returns for the same fact", () => {
    // One sentence for one situation, whichever layer refuses.
    expect(CONTROL_OWNERSHIP_ERROR).toBe("step_gate_not_owning_role");
    expect(refusalSlice()).toContain('"step_gate_not_owning_role"');
    expect(code("lib/process/engine/types.ts")).toContain('| "step_gate_not_owning_role"');
  });

  it("04 — and it resolves to a French sentence that names a role, never a person", () => {
    expect(hasProcessErrorFr(CONTROL_OWNERSHIP_ERROR)).toBe(true);
    const fr = processErrorFr(CONTROL_OWNERSHIP_ERROR);
    expect(fr).toContain("rôle responsable");
    expect(fr).not.toMatch(/@|[0-9a-f]{8}-/);
  });
});

// ===========================================================================
// WHERE IT BITES, AND WHERE IT DELIBERATELY DOES NOT
// ===========================================================================

describe("an unclaimed owned step refuses a foreign role", () => {
  const CHEF = ["CHIEF_OF_TRANSIT"];
  const DECLARANT = ["CUSTOMS_DECLARANT"];
  const ME = "user-me";

  it("05 — the Chef cannot self-claim the Déclarant's step 6", () => {
    // The escalation, stated as the rule that now refuses it.
    const v = evaluateControlOwnership({
      hasInstance: true,
      owningRole: "CUSTOMS_DECLARANT",
      actorRoles: CHEF,
      stepAssignedUserId: null,
      userId: ME,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("not_owning_role");
  });

  it("06 — the Déclarant can", () => {
    const v = evaluateControlOwnership({
      hasInstance: true,
      owningRole: "CUSTOMS_DECLARANT",
      actorRoles: DECLARANT,
      stepAssignedUserId: null,
      userId: ME,
    });
    expect(v).toEqual({ allowed: true, reason: "owning_role" });
  });

  it("07 — SYSTEM_ADMIN gets no implicit bypass", () => {
    // Ratified 2026-09-06 and restated here because a contextual surface is the
    // obvious place for someone to add one "just for support".
    for (const roles of [["SYSTEM_ADMIN"], ["SYSTEM_ADMIN", "CHIEF_OF_TRANSIT"]]) {
      const v = evaluateControlOwnership({
        hasInstance: true,
        owningRole: "CUSTOMS_DECLARANT",
        actorRoles: roles,
        stepAssignedUserId: null,
        userId: ME,
      });
      expect(v.allowed, roles.join("+")).toBe(false);
    }
    expect(refusalSlice()).not.toContain("SYSTEM_ADMIN");
    expect(activateSlice()).not.toContain("isSystemAdmin");
  });

  it("08 — an AUDITED ASSIGNMENT still wins: assign, then act", () => {
    // The ratified escape hatch. Every journey in this repository depends on
    // it: the Chef assigns step 6 to himself with `assignTransitStep` — which
    // writes an audit row naming who took what — and only then starts it.
    const v = evaluateControlOwnership({
      hasInstance: true,
      owningRole: "CUSTOMS_DECLARANT",
      actorRoles: CHEF,
      stepAssignedUserId: ME,
      userId: ME,
    });
    expect(v).toEqual({ allowed: true, reason: "assigned_to_self" });
    // …and the guard short-circuits on ANY assignee before it ever reads the
    // role, so the hatch cannot be closed by accident.
    expect(refusalSlice()).toContain("if (assignedUserId !== null) return null;");
  });

  it("09 — a step with no owning role is untouched", () => {
    // `bon_a_delivrer`, `pre_gate` and `transport_docs_transmission` carry no
    // row in the registry mirror. The compatibility path is the same one the
    // control gate documents; without it those steps would become unstartable.
    const v = evaluateControlOwnership({
      hasInstance: true,
      owningRole: null,
      actorRoles: CHEF,
      stepAssignedUserId: null,
      userId: ME,
    });
    expect(v).toEqual({ allowed: true, reason: "unowned_step" });
  });
});

// ===========================================================================
// WHERE IT SITS IN THE SEQUENCE
// ===========================================================================

describe("the guard is wired into activateStep, in the right place", () => {
  it("10 — activateStep calls it, and refuses on it", () => {
    const s = activateSlice();
    expect(s).toContain("const roleRefusal = await owningRoleRefusal(stepKey, st.assignedUserId ?? null, c);");
    expect(s).toContain("if (roleRefusal) return fail(roleRefusal);");
  });

  it("11 — after permission, prerequisites, custody and assignment", () => {
    // Order is operator-facing, not merely tidy: a caller should learn the step
    // is not open, or is somebody else's, before learning it is not their
    // role's. It also keeps the negative journeys' observed codes unchanged.
    const s = activateSlice();
    const at = (needle: string) => {
      const i = s.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    expect(at("prerequisitesMet(stepKey, views)")).toBeLessThan(at("owningRoleRefusal("));
    expect(at("custodyRefusal(stepKey")).toBeLessThan(at("owningRoleRefusal("));
    expect(at("assignmentRefusal(")).toBeLessThan(at("owningRoleRefusal("));
  });

  it("12 — and BEFORE anything is written", () => {
    // The point of a guard. `cas(...)` is the write that claims the step.
    const s = activateSlice();
    expect(s.indexOf("owningRoleRefusal(")).toBeLessThan(s.indexOf("const ok = await cas("));
  });

  it("13 — the claim write is still what it was: this adds a condition, not a behaviour", () => {
    const s = activateSlice();
    expect(s).toContain('state: "ACTIVE"');
    expect(s).toContain("assigned_user_id: c.userId");
    expect(s).toContain("AuditActions.PROCESS_STEP_ACTIVATED");
  });
});

// ===========================================================================
// SCOPE HELD
// ===========================================================================

describe("nothing else moved", () => {
  it("14 — assertControlStep is untouched", () => {
    const gate = code("lib/process/control-gate.ts");
    expect(gate).toContain("export function evaluateControlGate");
    // The pure gate still answers only its two questions.
    expect(gate).not.toContain("owningRole");
    expect(gate).not.toContain("actorRoles");
  });

  it("15 — assertControlOwner is untouched: this REUSES it, it does not widen it", () => {
    const own = code("lib/process/control-ownership.ts");
    expect(own).toContain('if (!input.hasInstance) return { allowed: true, reason: "no_instance" };');
    expect(own).toContain('if (!input.owningRole) return { allowed: true, reason: "unowned_step" };');
    expect(own).toContain("input.actorRoles.includes(input.owningRole)");
  });

  it("16 — submitStep is NOT gated by this: it would be a new blocker on live dossiers", () => {
    // An ACTIVE step already has an assignee, so the escalation is closed at the
    // claim. Adding the same check to submit would refuse in-flight work that
    // was legitimately claimed before this rule existed — a new hard blocker,
    // which the leniency doctrine says must not be introduced without evidence.
    const i = actions.indexOf("export async function submitStep");
    const rest = actions.slice(i);
    const j = rest.indexOf("\nexport ", 1);
    expect(rest.slice(0, j > 0 ? j : undefined)).not.toContain("owningRoleRefusal");
  });

  it("17 — the 26-step graph is unchanged", () => {
    expect(EFFITRANS_PROCESS.filter((s) => s.stepNumber !== null && s.stepNumber !== undefined).length)
      .toBeGreaterThanOrEqual(26);
    const keys = new Set(EFFITRANS_PROCESS.map((s) => s.key));
    for (const k of ["customs_preparation", "gainde_registration", "gainde_document_submission"]) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it("18 — no permission grant was widened to make this pass", () => {
    const templates = code("lib/platform/role-templates.ts");
    // The remedy for a refusal here is an audited assignment, never a grant.
    const chef = templates.slice(templates.indexOf("CHIEF_OF_TRANSIT"));
    expect(chef.slice(0, 2000)).not.toContain('"process:owner:assign"');
  });
});

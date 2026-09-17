/**
 * UAT-PARALLEL-OWNERSHIP-01 — the parallel activities get their owning role.
 * ---------------------------------------------------------------------------
 * WHAT PRODUCTION SHOWED, on EFT-IMP-2026-00011. The dossier displayed
 * « Account Manager — obtenir le Bon à Délivrer » with « En cours : Omar
 * Gadiaga », who holds Coordinateur des opérations, Agent de terrain douane,
 * Agent d'enlèvement and Coursier — and no Account Manager role. The audit is
 * unambiguous about how: `process.step.activated` by his own account at
 * 2026-09-09 13:47:33.93, the same instant as the row's `started_at`. He
 * self-claimed. Nothing assigned him, no routing chose him, nothing was
 * inherited. It happened on EFT-IMP-2026-00012 as well.
 *
 * WHY THE PLATFORM ALLOWED IT. `activateStep` asks `owningRoleRefusal`, which
 * asks `evaluateControlOwnership` for the owning role — and reads it from
 * `process_step_owning_role`, seeded with « one row per official step », all 26
 * of them. The three PARALLEL ACTIVITIES had no row. `evaluateControlOwnership`
 * then answers `unowned_step`, which is a deliberate deferral, and the only
 * remaining gate is the activity's permission: `document:create`, held by
 * fourteen roles because each needs it for its own work.
 *
 * So the control was never bypassed. For these three activities it had never
 * been armed, and this slice arms it — by adding the missing rows to the SAME
 * table, not by inventing a second ownership registry and not by special-casing
 * the Bon à Délivrer.
 *
 * ⚠ THE REGISTRY'S `role` FIELD IS NOT THE SOURCE, and must not become one.
 * DEC-C35 ratified that it is documentary: it names CHIEF_TRANSIT,
 * COTATION_OFFICER and OPERATIONS_MANAGER, three roles that exist in no tenant.
 * Deriving the gate from it would make phantom roles authoritative.
 *
 * WHAT DOES NOT CHANGE. Permission to perform a capability is still not
 * authority to own an activity: an Account Manager needs BOTH. An activity that
 * is already claimed keeps its claimant — the ownership question is only asked
 * of an UNASSIGNED step — so no historical execution is rewritten.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { evaluateControlOwnership } from "@/lib/process/control-ownership";
import { PARALLEL_ACTIVITIES, EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { getNode, stepPermission } from "@/lib/process/engine/state";
import { getTenantRoleTemplate } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const SEED = "supabase/migrations/20260914000001_responsibility_visibility.sql";
const SLICE = "supabase/migrations/20261006000001_parallel_activity_owning_roles.sql";

/** The owning-role map as the DATABASE will hold it: both seeds together. */
function owningRoleMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const migration of [SEED, SLICE]) {
    const sql = read(migration);
    const start = sql.indexOf("insert into public.process_step_owning_role");
    expect(start, `seed missing in ${migration}`).toBeGreaterThan(-1);
    const block = sql.slice(start, sql.indexOf(";", start));
    for (const m of block.matchAll(/\('([a-z_]+)',\s*'([A-Z_]+)'/g)) out.set(m[1], m[2]);
  }
  return out;
}

/** Omar's real roles on the production tenant, as the Users screen shows them. */
const OMAR_ROLES = ["COORDINATOR", "COURIER", "CUSTOMS_FIELD_AGENT", "PICKUP_AGENT"];
const AM_ROLES = ["ACCOUNT_MANAGER"];

// ================================================= A. STRUCTURAL COVERAGE ==

describe("A — every activity with a declared owner is covered by the mechanism", () => {
  const map = owningRoleMap();

  it("01 — all three parallel activities are mapped, to ACCOUNT_MANAGER", () => {
    expect(PARALLEL_ACTIVITIES).toHaveLength(3);
    for (const a of PARALLEL_ACTIVITIES) {
      expect(map.get(a.key), `${a.key} must have an owning role`).toBe("ACCOUNT_MANAGER");
    }
  });

  it("02 — ⚠ THE GAP ITSELF: no registry node with a declared role is left unmapped", () => {
    // The defect was structural coverage, so the assertion is structural. Every
    // node the registry declares a role for must appear in the authoritative
    // map — steps and activities alike, with no carve-out for the latter.
    const declared = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES].filter((n) => Boolean(n.role));
    const unmapped = declared.filter((n) => !map.has(n.key)).map((n) => n.key);
    expect(unmapped, `unmapped nodes: ${unmapped.join(", ")}`).toEqual([]);
    expect(map.size).toBe(29);
  });

  it("03 — the map still holds the 26 numbered steps, unchanged", () => {
    for (const step of EFFITRANS_PROCESS) expect(map.has(step.key), step.key).toBe(true);
    const seedOnly = read(SEED);
    // The original seed is not rewritten: a shipped migration stays shipped.
    expect(seedOnly).toContain("expected 26 (one per official step)");
    expect(code(SLICE)).not.toContain("delete from");
    expect(code(SLICE)).not.toContain("update public.process_step_owning_role");
  });

  it("04 — and the owner can actually DO the work (the step-16 trap, not repeated)", () => {
    const am = getTenantRoleTemplate("ACCOUNT_MANAGER")!;
    for (const a of PARALLEL_ACTIVITIES) {
      for (const permission of a.permissions) {
        expect(am.permissions, `${a.key} needs ${permission}`).toContain(permission);
      }
      // …including the one the engine actually gates on.
      expect(am.permissions, a.key).toContain(stepPermission(a.key));
    }
  });
});

// =================================================== B. THE CLAIM DECISION ==

describe("B — who may claim an unowned-no-longer activity", () => {
  const map = owningRoleMap();
  const claim = (stepKey: string, actorRoles: readonly string[], assigned: string | null = null) =>
    evaluateControlOwnership({
      hasInstance: true,
      owningRole: map.get(stepKey) ?? null,
      actorRoles,
      stepAssignedUserId: assigned,
      userId: "u-actor",
    });

  it("05 — ⚠ THE REGRESSION: a Coordinator may no longer self-claim the Bon à Délivrer", () => {
    const verdict = claim("bon_a_delivrer", OMAR_ROLES);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("not_owning_role");
    // Holding the activity's permission changes nothing: `document:create` is
    // what fourteen roles hold, and it was the only gate before this slice.
    expect(getTenantRoleTemplate("COORDINATOR")!.permissions).toContain("document:create");
    expect(stepPermission("bon_a_delivrer")).toBe("document:create");
  });

  it("06 — an eligible Account Manager may", () => {
    const verdict = claim("bon_a_delivrer", AM_ROLES);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe("owning_role");
  });

  it("07 — the same holds for the other two activities, in both directions", () => {
    for (const key of ["pre_gate", "transport_docs_transmission"]) {
      expect(claim(key, OMAR_ROLES).allowed, `${key} / coordinator`).toBe(false);
      expect(claim(key, AM_ROLES).allowed, `${key} / account manager`).toBe(true);
    }
  });

  it("08 — before this slice the very same call was ALLOWED — the defect, reproduced", () => {
    // Owning role null is exactly what production returned for these keys, and
    // `unowned_step` is the deferral that let the claim through.
    const asItWas = evaluateControlOwnership({
      hasInstance: true,
      owningRole: null,
      actorRoles: OMAR_ROLES,
      stepAssignedUserId: null,
      userId: "u-omar",
    });
    expect(asItWas.allowed).toBe(true);
    expect(asItWas.reason).toBe("unowned_step");
  });

  it("09 — no role other than the owner may claim, including platform admin", () => {
    for (const roles of [["SYSTEM_ADMIN"], ["OPS_SUPERVISOR"], ["TRANSPORT_OFFICER"], []]) {
      expect(claim("bon_a_delivrer", roles).allowed, roles.join("+") || "(no roles)").toBe(false);
    }
    // The ratified escape hatch is unchanged and is an AUDITED assignment, not
    // implicit inheritance: an assignee — whoever they are — owns their step.
    expect(claim("bon_a_delivrer", OMAR_ROLES, "u-actor").allowed).toBe(true);
    expect(claim("bon_a_delivrer", OMAR_ROLES, "u-actor").reason).toBe("assigned_to_self");
  });

  it("10 — an ALREADY-CLAIMED activity is not re-judged, so history is not rewritten", () => {
    // EFT-IMP-2026-00011's Bon à Délivrer is ACTIVE and claimed by a
    // non-Account-Manager. The ownership question is asked only of an
    // UNASSIGNED step, so that row keeps its claimant, state and timestamps.
    const someoneElse = claim("bon_a_delivrer", AM_ROLES, "u-omar");
    expect(someoneElse.allowed).toBe(true);
    expect(someoneElse.reason).toBe("assigned_to_other");
    expect(code("lib/process/engine/actions.ts"))
      .toContain("if (assignedUserId !== null) return null;");
  });
});

// ================================================= C. THE ENGINE WIRING ====

describe("C — the gate is the existing one, wired to the existing table", () => {
  it("11 — activateStep asks the shared rule with the authoritative role", () => {
    const actions = code("lib/process/engine/actions.ts");
    expect(actions).toContain("owningRole: await stepOwningRole(stepKey)");
    expect(actions).toContain("evaluateControlOwnership({");
    expect(actions).toContain('return verdict.allowed ? null : "step_gate_not_owning_role";');
    // Refusal happens inside activateStep, before the state write.
    const activate = actions.slice(
      actions.indexOf("export async function activateStep"),
      actions.indexOf("export async function submitStep"),
    );
    expect(activate).toContain("await owningRoleRefusal(stepKey, st.assignedUserId ?? null, c)");
    expect(activate.indexOf("owningRoleRefusal")).toBeLessThan(activate.indexOf("await cas("));
  });

  it("12 — NO special case was added for any single activity", () => {
    for (const p of [
      "lib/process/engine/actions.ts",
      "lib/process/control-ownership.ts",
      "lib/process/control-ownership-server.ts",
      "lib/process/contextual/owning-roles.ts",
    ]) {
      const s = code(p);
      for (const key of ["bon_a_delivrer", "pre_gate", "transport_docs_transmission", "BON_A_DELIVRER"]) {
        expect(s.includes(key), `${p} special-cases ${key}`).toBe(false);
      }
    }
  });

  it("13 — and the reader still refuses the documentary registry role", () => {
    const reader = code("lib/process/contextual/owning-roles.ts");
    expect(reader).toContain("process_step_owning_role");
    const phantom = ["CHIEF_TRANSIT", "COTATION_OFFICER", "OPERATIONS_MANAGER"];
    for (const role of phantom) {
      expect(getTenantRoleTemplate(role), `${role} must not be a real role`).toBeUndefined();
      // …and none of them reached the authoritative map.
      expect([...owningRoleMap().values()], role).not.toContain(role);
    }
  });
});

// ===================================================== D. THE MIGRATION ====

describe("D — the migration is additive and self-checking", () => {
  const sql = read(SLICE);

  it("14 — it inserts three rows and nothing else", () => {
    expect(sql).toContain("insert into public.process_step_owning_role");
    expect(sql).toContain("on conflict (step_key, role_code) do nothing");
    for (const key of ["bon_a_delivrer", "pre_gate", "transport_docs_transmission"]) {
      expect(sql, key).toContain(`('${key}',`);
    }
    // No other table is WRITTEN: no execution row, no claimant, no permission.
    // It does READ `process_step_execution`, once, to report how many
    // activities are already claimed — the assertion that this slice changes
    // the future without touching the past.
    const body = code(SLICE);
    expect(body).not.toMatch(/update public\.|delete from public\./);
    expect(body).not.toMatch(/insert into public\.(?!process_step_owning_role)/);
    expect(body).toMatch(/select count\(\*\) into v_claimed\s+from public\.process_step_execution/);
  });

  it("15 — it refuses to land if the map is wrong afterwards", () => {
    expect(sql).toContain("expected 29 (26 official steps + 3 parallel activities)");
    expect(sql).toContain("must be owned by ACCOUNT_MANAGER");
    // The step-16 trap check: the owner must hold every permission it needs.
    expect(sql).toContain("ACCOUNT_MANAGER cannot execute its own activities");
    expect(sql).toContain("process:handoff:send");
  });

  it("16 — it is the newest migration and the ledger will count it", () => {
    expect(SLICE).toMatch(/20261006000001_parallel_activity_owning_roles\.sql$/);
  });
});

// ============================================== E. NOTHING ELSE MOVED ======

describe("E — neighbouring doctrine is untouched", () => {
  it("17 — OPS-LENIENCY-02 still makes the artefacts hard at their own activity", () => {
    const cls = code("lib/process/requirement-class.ts");
    for (const key of [
      '"bon_a_delivrer::BON_A_DELIVRER": hard(ARTEFACT_IS_THE_ACT)',
      '"pre_gate::PRE_GATE_AUTHORIZATION": hard(ARTEFACT_IS_THE_ACT)',
    ]) {
      expect(cls, key).toContain(key);
    }
    expect(cls).toContain('"am_delivery_followup::SIGNED_DELIVERY_NOTE": soft(');
  });

  it("18 — the convergence gate still reads documents, never roles or classes", () => {
    const gates = code("lib/process/engine/gates.ts");
    expect(gates).not.toContain("blocksCompletion");
    expect(gates).not.toContain("process_step_owning_role");
    expect(gates).toContain('checkEvidence("BON_A_DELIVRER", snap)');
  });

  it("19 — and no new permission, role or exception was created", () => {
    const body = code(SLICE);
    expect(body).not.toContain("insert into public.permission");
    expect(body).not.toContain("insert into public.role ");
    // The only escape hatch remains the audited assignment that already existed.
    expect(code("lib/process/control-ownership.ts")).toContain('reason: "assigned_to_self"');
  });
});

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

// ========================================== F. THE VERIFIER'S SECURITY =====
//
// UAT-PARALLEL-OWNERSHIP-01-VERIFIER-FIX. Production Run #8 applied this
// migration's SQL and then failed its verifier, leaving the ledger unwritten on
// a database that was correctly protected. The verifier had required anon and
// authenticated to LACK table grants; the hosted project grants `arwdDxtm` on
// every table in `public` to both by default privileges and enforces with RLS.
// These tests pin the layer the check is allowed to ask, and the root-cause
// rule that made asking the wrong one possible.

const VERIFIER = "supabase/verifiers/20261006000001_parallel_activity_owning_roles.verify.sql";

describe("F — the security assertion asks RLS, not GRANTs", () => {
  const v = read(VERIFIER);

  it("20 — ⚠ THE INCIDENT: it no longer requires write GRANTs to be absent", () => {
    // The exact shape that failed in production. `has_table_privilege` may not
    // decide the security question here at all: broad grants are this
    // platform's design, so the assertion was false on every table in the
    // database, including 169 that have nothing to do with this slice.
    expect(v).not.toMatch(/has_table_privilege\s*\(\s*'(anon|authenticated)'/);
    expect(v).not.toContain("the map is readable but not writable by authenticated or anon");
  });

  it("21 — it asserts RLS is on, and that neither client role bypasses it", () => {
    expect(v).toContain("relrowsecurity");
    expect(v).toContain("rolbypassrls");
    expect(v).toMatch(/rolname in \('anon', 'authenticated'\)/);
  });

  it("22 — no PERMISSIVE write policy may reach anon or authenticated", () => {
    // Catalog-level, not the text of `pg_policies`: roles are resolved through
    // OIDs so a policy granted to PUBLIC — or to any role those two inherit —
    // is caught exactly like one that names them.
    expect(v).toContain("pg_policy");
    expect(v).toContain("polpermissive");
    expect(v).toMatch(/polcmd in \('\*', 'a', 'w', 'd'\)/);
    expect(v).toContain("0 = any (p.polroles)");
    expect(v).toContain("pg_has_role(g.rolname, pr.oid, 'MEMBER')");
    // RESTRICTIVE policies only narrow; reading one as a grant would make the
    // check fail on a database that had just been made SAFER.
    expect(v).toContain("polpermissive");
  });

  it("23 — and the map must stay READABLE, or F-1 breaks instead of holding", () => {
    // A check that only forbade writes would pass just as happily on a table
    // nobody can read. Both halves, or neither.
    expect(v).toMatch(/polcmd in \('\*', 'r'\)/);
    expect(v).toContain("pg_has_role('authenticated', pr.oid, 'MEMBER')");
  });

  it("24 — ⚠ THE ROOT CAUSE: the migration establishes no security at all", () => {
    // This is the rule the old check broke, and the one that keeps it broken if
    // it is ever forgotten: a verifier asserts what ITS migration makes true.
    // This migration contains no grant, no policy and no RLS statement — so its
    // verifier may observe the security layer, never demand a shape of it that
    // the migration did not create.
    const body = code(SLICE);
    expect(body).not.toMatch(/\bgrant\b|\brevoke\b/i);
    expect(body).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(body).not.toMatch(/row level security/i);
    expect(body).not.toMatch(/^\s*alter table/im);
  });

  it("25 — the verifier is still read-only and still returns (ok, detail)", () => {
    expect(v).toMatch(/bool_and\(ok\)\s+as\s+ok/);
    expect(v).toMatch(/\bdetail\b/);
    expect(v).not.toMatch(/^\s*(insert|update|delete|truncate|alter|drop|grant|revoke|create)\s+/im);
    expect(v).not.toMatch(/\bdo\s+\$\$/i);
    // A verifier's evidence is the schema, never the ledger.
    expect(v).not.toContain("supabase_migrations");
  });
});

// ================================ G. THE PROBE THAT WOULD HAVE CAUGHT IT ===

describe("G — CI now exercises a production-shaped database", () => {
  const probe = read("scripts/verifier-security-probe.mjs");
  const ci = read(".github/workflows/ci.yml");

  it("26 — the probe grants the broad privileges production actually has", () => {
    // Without this line the probe would test the same forgiving database CI
    // always had, and would have signed off the failing check exactly as the
    // original run did.
    expect(probe).toContain("grant all on ${TABLE} to anon, authenticated");
    expect(probe).toContain("has_table_privilege");
  });

  it("27 — it runs the REAL verifier file rather than a copy of its logic", () => {
    expect(probe).toContain("queryFile(tgt, VERIFIER)");
    expect(probe).toContain('const VERSION = "20261006000001"');
    expect(probe).toContain("_parallel_activity_owning_roles.verify.sql");
  });

  it("28 — it injects every way the protection could be lost", () => {
    // The three single-command write policies are generated from one list, so
    // the list IS the assertion — checking for the rendered strings would pass
    // just as well if two of the three were quietly dropped from it.
    expect(probe).toContain('[["3", "insert"], ["4", "update"], ["5", "delete"]]');
    expect(probe).toContain("for ${cmd} to authenticated");
    for (const fragment of [
      "disable row level security",
      "for insert to public",
      "for all to authenticated",
      "as restrictive for insert",
      "drop policy process_step_owning_role_select",
      "delete from ${TABLE} where step_key = 'pre_gate'",
      "set role_code = 'COORDINATOR'",
    ]) {
      expect(probe, fragment).toContain(fragment);
    }
  });

  it("29 — and requires the guard to see SCHEMA_AHEAD_OF_LEDGER", () => {
    expect(probe).toContain("SCHEMA_AHEAD_OF_LEDGER");
    expect(probe).toContain('repair(tgt, VERSION, undefined, "reverted")');
    expect(probe).toContain('repair(tgt, VERSION, undefined, "applied")');
    expect(probe).toContain("migration-integrity.mjs");
  });

  it("30 — it refuses any database that is not disposable", () => {
    expect(probe).toContain("assertDisposable");
    expect(probe).toContain("LOCAL_HOSTS");
    expect(probe).toMatch(/finally\s*\{/);
  });

  it("31 — CI runs it, against the local stack only", () => {
    expect(ci).toContain("node scripts/verifier-security-probe.mjs --db-url");
    expect(ci).toContain("127.0.0.1:54322");
    // After the verifier sweep, before the rehearsal reshapes the ledger.
    const probeAt = ci.indexOf("verifier-security-probe.mjs");
    const sweepAt = ci.indexOf("verify-migrations.mjs");
    const rehearsalAt = ci.indexOf("migration-rehearsal.mjs");
    expect(sweepAt).toBeGreaterThan(-1);
    expect(probeAt).toBeGreaterThan(sweepAt);
    expect(probeAt).toBeLessThan(rehearsalAt);
  });

  it("33 — ⚠ THE PROBE'S OWN REGRESSION: the migration is multi-statement", () => {
    // PR #10's first CI run died here, before a single adversarial case ran:
    //   « cannot insert multiple commands into a prepared statement »
    // The probe had applied the migration through `supabase db query --db-url`,
    // which reaches Postgres over the EXTENDED query protocol — one command per
    // message. This migration is an `insert …;` AND a `do $$ … $$;` guard block.
    //
    // Pinned here so the rest of this section cannot become vacuous: if the
    // migration ever collapsed to a single statement, the psql requirement
    // below would still read green while guarding nothing.
    const body = code(SLICE).trim().replace(/;\s*$/, "");
    expect(body).toContain(";");
    expect(body).toMatch(/insert into public\.process_step_owning_role/);
    expect(body).toMatch(/do \$\$/);
  });

  it("34 — so it is applied with psql, never through the prepared-statement path", () => {
    // psql sends a file over the SIMPLE query protocol, which carries several
    // commands in one message — the same transport the production runner gets
    // through the pooler.
    expect(probe).toContain("applyMigrationFile(url, MIGRATION)");
    expect(probe).toMatch(/execFileSync\(\s*"psql"/);
    expect(probe).toContain("ON_ERROR_STOP=1");
    // The old path must not come back for the migration.
    expect(probe).not.toContain("applyFile(tgt, MIGRATION)");
    // …and the file is still the one that ships: never read, split or inlined.
    expect(probe).toContain("_parallel_activity_owning_roles.sql");
  });

  it("35 — the single-statement helper REFUSES multi-statement SQL", async () => {
    // Behavioural, not textual: a comment saying "one statement per call" is
    // exactly what failed to prevent this, so the guard is tested for what it
    // does. Importing works because the script only runs main() when invoked
    // as a script.
    const mod = await import("../scripts/verifier-security-probe.mjs");
    expect(() => mod.assertSingleStatement("t", "select 1; select 2")).toThrow(
      /more than one statement/,
    );
    expect(() => mod.assertSingleStatement("t", "create policy p on t for insert to anon with check (true); drop policy p on t")).toThrow();
    // A single statement still passes, with or without a trailing semicolon.
    expect(() => mod.assertSingleStatement("t", "grant all on x to anon")).not.toThrow();
    expect(() => mod.assertSingleStatement("t", "grant all on x to anon;  ")).not.toThrow();
  });

  it("32 — the integrity guard itself was NOT changed: the fix is the verifier", () => {
    // The guard was never wrong. It distinguishes applied-but-unrecorded from
    // not-yet-applied by asking the companion verifier, and it asked correctly;
    // the verifier answered falsely. Changing the guard to work around that
    // would have removed the only evidence it has.
    const guard = read("scripts/migration-integrity.mjs");
    expect(guard).toContain("verdict.ok === true");
    expect(guard).toContain("SCHEMA_AHEAD_OF_LEDGER");
    expect(guard).not.toContain("process_step_owning_role");
    expect(guard).not.toContain("20261006000001");
  });
});

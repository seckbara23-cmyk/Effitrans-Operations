/**
 * OPS-SEC-2A — Trusted Actor Framework, structural contracts.
 *
 * The behaviour lives in SQL, against a real PostgreSQL, in
 * `supabase/tests/ops_sec_2a_trusted_actor_test.sql` — because that is the only
 * place a lane can actually be exercised. What SQL cannot pin is what this
 * phase must NOT contain: the scope exclusions, and the shape of the framework
 * that keeps its guarantees honest.
 *
 * The one contract worth stating plainly: the primitive is trustworthy only
 * because THE CALLER DECLARES ITS LANE AND THE PRIMITIVE VERIFIES THE
 * DECLARATION. If a declaration were ever taken at face value, "SERVICE" would
 * become a nomination bypass for any browser caller.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const MIGRATION = "supabase/migrations/20260815000001_trusted_actor_framework.sql";
const PERSONA = "supabase/tests/ops_sec_2a_trusted_actor_test.sql";
const INVARIANTS = "supabase/tests/ops_sec_2a_catalog_invariants_test.sql";
const CI = ".github/workflows/ci.yml";

const sql = read(MIGRATION);
/** SQL with `--` comments stripped: a comment naming an excluded object is
 *  documentation of the exclusion, not a violation of it. */
const sqlCode = sql.replace(/^\s*--.*$/gm, "");

// ---------------------------------------------------------------------------
// 1. The primitive
// ---------------------------------------------------------------------------
describe("the canonical assertion primitive", () => {
  it("exists with the ratified four-argument shape", () => {
    expect(sql).toMatch(/create or replace function public\.assert_actor_authority\(/);
    for (const arg of ["p_actor", "p_tenant", "p_permission", "p_context"]) {
      expect(sql, arg).toContain(arg);
    }
  });

  it("is SECURITY DEFINER with a pinned search_path", () => {
    const fn = sql.slice(sql.indexOf("function public.assert_actor_authority"));
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public, pg_temp");
  });

  it("implements exactly three lanes and refuses everything else", () => {
    for (const lane of ["INTERACTIVE", "SERVICE", "SYSTEM"]) {
      expect(sql, lane).toContain(`p_context = '${lane}'`);
    }
    // The catch-all. Unknown context must never fall through to success.
    expect(sql).toContain("unknown execution context");
  });

  it("VERIFIES the declared lane against the observed session", () => {
    // Both directions, because either alone is a hole:
    //   a session claiming SERVICE would be a nomination bypass;
    //   a service claiming INTERACTIVE would bypass the actor check.
    expect(sql).toContain("SERVICE declared from an authenticated session");
    expect(sql).toContain("INTERACTIVE declared but there is no authenticated session");
  });

  it("forbids nomination in the interactive lane", () => {
    expect(sql).toContain("an interactive caller may act only as itself");
  });

  it("treats service-role as transport, not authority", () => {
    // The three service-lane checks that make it verification rather than trust.
    const svc = sql.slice(sql.indexOf("p_context = 'SERVICE'"), sql.indexOf("p_context = 'SYSTEM'"));
    expect(svc).toContain("nominated actor does not exist");
    expect(svc).toContain("does not belong to that tenant");
    expect(svc).toContain("get_user_permissions");
  });

  it("derives the interactive tenant instead of accepting it", () => {
    const inter = sql.slice(sql.indexOf("p_context = 'INTERACTIVE'"), sql.indexOf("p_context = 'SERVICE'"));
    expect(inter).toContain("from public.app_user u where u.id = v_session");
    expect(inter).toContain("tenant does not match the session identity");
  });

  it("fails the SYSTEM lane closed, and says why in the file", () => {
    // Not an oversight — the identity model cannot host a non-login principal,
    // and that reasoning must survive next to the code.
    expect(sql).toContain("SYSTEM lane is not implemented");
    expect(sql).toContain("FOREIGN KEY to auth.users");
  });
});

// ---------------------------------------------------------------------------
// 2. The pilot
// ---------------------------------------------------------------------------
describe("the pilot is minimal, additive and reversible", () => {
  it("converts exactly two functions", () => {
    const overloads = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)]
      .map((m) => m[1])
      .filter((n) => n !== "assert_actor_authority");
    expect(new Set(overloads)).toEqual(new Set(["next_file_number", "next_employee_number"]));
  });

  it("adds OVERLOADS — no existing signature is replaced", () => {
    // next_file_number(uuid,text) and next_employee_number(uuid) must keep
    // working, or applying this migration breaks the running deploy.
    expect(sql).toContain("p_tenant uuid,\n  p_type   text,\n  p_actor  uuid");
    expect(sql).toContain("return public.next_file_number(p_tenant, p_type);");
    expect(sql).toContain("return public.next_employee_number(p_tenant);");
  });

  it("reuses the existing numbering logic rather than copying it", () => {
    // One counter definition. A second would drift and issue duplicates.
    expect(sql).not.toMatch(/insert into public\.\w*counter/i);
  });

  it("maps each pilot to the permission its call site already asserts", () => {
    // createFile -> file:create ; createEmployee -> guard() -> hr:manage
    expect(sql).toContain("'file:create', 'SERVICE'");
    expect(sql).toContain("'hr:manage', 'SERVICE'");
    expect(read("lib/files/actions.ts")).toContain('assertPermission("file:create")');
    expect(read("lib/hr/actions.ts")).toContain('assertPermission("hr:manage")');
  });

  it("hard-codes the SERVICE lane, which is safe only because it is verified", () => {
    // If one of these were ever reached from a session, the lane check refuses
    // it — the declaration is not trusted.
    expect(sql).toContain("hard-coded rather than accepted");
  });
});

// ---------------------------------------------------------------------------
// 3. Scope exclusions — what this phase must not have touched
// ---------------------------------------------------------------------------
describe("scope exclusions hold", () => {
  it("does not modify migrations 90-92", () => {
    for (const m of ["20260814000001_ops_sec_1_rpc_privilege_lockdown.sql",
                     "20260814000002_ops_sec_1_lockdown_addendum.sql",
                     "20260814000003_ops_sec_1_restore_policy_dependency.sql"]) {
      expect(existsSync(join(root, "supabase/migrations", m)), m).toBe(true);
    }
    // …and this migration ACTS on none of the excluded objects. Checked against
    // comment-stripped SQL, because the header legitimately names them while
    // explaining what it deliberately does not touch.
    for (const forbidden of ["emit_business_event", "can_read_file",
                             "user_readable_file_ids", "portal_can_read_file"]) {
      expect(sqlCode, forbidden).not.toContain(forbidden);
    }
  });

  it("performs no broad privilege sweep", () => {
    // Exactly the three objects it creates.
    const revokes = [...sqlCode.matchAll(/'(public\.[a-z_]+\([^']*\))'/g)].map((m) => m[1]);
    expect(new Set(revokes).size).toBe(3);
  });

  it("changes no table, policy, trigger or role template", () => {
    for (const forbidden of [/create\s+table/i, /alter\s+table/i, /create\s+policy/i,
                             /alter\s+policy/i, /create\s+trigger/i, /drop\s+function/i]) {
      expect(sql, String(forbidden)).not.toMatch(forbidden);
    }
    expect(sql).not.toContain("role_permission");
  });

  it("writes no business data", () => {
    expect(sql).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("leaves the application call sites unchanged, so applying it cannot break a deploy", () => {
    // The pilot overloads are dark until OPS-SEC-2B switches the callers. A
    // migration and a deploy land separately here, so a call site that needs a
    // not-yet-applied function is an outage waiting for the gap.
    // Both still call the ORIGINAL signatures — no p_actor is passed anywhere.
    const files = read("lib/files/actions.ts");
    expect(files).toContain('.rpc("next_file_number"');
    expect(files).not.toContain("p_actor");
    const hr = read("lib/hr/actions.ts");
    expect(hr).toContain('.rpc("next_employee_number"');
    expect(hr).not.toContain("p_actor");
  });
});

// ---------------------------------------------------------------------------
// 4. Verification is real, not vacuous
// ---------------------------------------------------------------------------
describe("the migration proves itself without relying on an empty database", () => {
  it("asserts privileges on all three new functions", () => {
    expect(sql).toContain("has_function_privilege('anon'");
    expect(sql).toContain("has_function_privilege('authenticated'");
    expect(sql).toContain("has_function_privilege('service_role'");
    expect(sql).toContain("aclexplode");
  });

  it("proves fail-closed behaviour with data-INDEPENDENT cases only", () => {
    // CI's organization table is empty at migration time. A data-dependent
    // assertion there would pass by accident.
    expect(sql).toContain("data-independent");
    for (const code of ["EFA17", "EFA16", "EFA02", "EFA11"]) {
      expect(sql, code).toContain(code);
    }
  });

  it("defers the data-dependent lanes to the persona suite", () => {
    const persona = read(PERSONA);
    expect(persona).toContain("assert_actor_authority");
    expect(persona).toContain("rollback;");
  });
});

// ---------------------------------------------------------------------------
// 5. The persona suite covers every required identity
// ---------------------------------------------------------------------------
describe("persona coverage", () => {
  const persona = read(PERSONA);

  it("covers all the required personas", () => {
    for (const check of [
      "anonymous_refused",
      "interactive_without_permission_refused",
      "interactive_self_accepted",
      "interactive_cross_tenant_refused",
      "service_valid_actor_accepted",
      "service_forged_actor_refused",
      "service_wrong_tenant_refused",
      "service_actor_without_permission_refused",
      "system_lane_closed",
      "human_cannot_be_automation",
      "session_cannot_claim_service",
      "interactive_cannot_nominate_other",
    ]) {
      expect(persona, check).toContain(check);
    }
  });

  it("proves acceptance as well as refusal", () => {
    // A suite that only proves refusals cannot distinguish "secure" from
    // "broken" — everything refuses when everything is broken.
    expect(persona).toContain("service_valid_actor_accepted");
    expect(persona).toContain("pilot_valid_nomination_accepted");
  });

  it("proves the refusal happens BEFORE the side effect", () => {
    // A refused call must not consume a file number.
    expect(persona).toContain("forged_pilot_call_allocated_nothing");
  });

  it("resolves roles by permission, not by name", () => {
    expect(persona).toContain("p.code = 'file:create'");
  });

  it("records results only after any role or claims are cleared", () => {
    // Writing to a temp table under a restricted role is how migration 89 failed.
    expect(persona).toContain("Recorded only now");
  });
});

// ---------------------------------------------------------------------------
// 6. Catalog invariants are wired into CI
// ---------------------------------------------------------------------------
describe("catalog-derived CI enforcement", () => {
  const inv = read(INVARIANTS);
  const ci = read(CI);

  it("covers every required invariant", () => {
    for (const id of ["INV-1", "INV-2", "INV-3", "INV-4", "INV-5", "INV-6", "INV-7"]) {
      expect(inv, id).toContain(id);
    }
  });

  it("derives from pg_catalog rather than a hand-written list", () => {
    expect(inv).toContain("pg_proc");
    expect(inv).toContain("has_function_privilege");
    expect(inv).toContain("pg_policy");
  });

  it("fails for anything NOT listed, never the reverse", () => {
    // The tenant-table registry is the cautionary tale: hand-maintained and
    // silent on 63 of 140 tables. These allowlists are denominators.
    expect(inv).toContain("ANYTHING NOT LISTED FAILS");
    expect(inv).toContain("count(*) <= 50");
  });

  it("computes the RLS closure transitively, not one hop", () => {
    expect(inv).toContain("with recursive");
  });

  it("both suites run in CI, before the database is stopped", () => {
    expect(ci).toContain("ops_sec_2a_trusted_actor_test.sql");
    expect(ci).toContain("ops_sec_2a_catalog_invariants_test.sql");
    expect(ci.indexOf("ops_sec_2a_catalog_invariants_test.sql"))
      .toBeLessThan(ci.indexOf("Stop local Supabase"));
  });

  it("surfaces a readable failure, since psql exit codes alone are not", () => {
    expect(ci).toContain("OPS-SEC-2A persona suite failed");
    expect(ci).toContain("catalog invariants failed");
  });
});

// ---------------------------------------------------------------------------
// 7. Chain hygiene
// ---------------------------------------------------------------------------
describe("migration chain", () => {
  it("is present and asserts its own position, not that it is newest", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(files).toContain("20260815000001_trusted_actor_framework.sql");
    expect(sql).not.toMatch(/newest migration|runs LAST/i);
  });
});

/**
 * OPS-SEC-1 — P0 privilege-only remediation (migration 90).
 *
 * The migration proves its own effect in SQL, against a real PostgreSQL, when
 * CI applies it. What SQL cannot pin is what the migration must NOT contain:
 * that it changes no behaviour, and that its exclusion lists are the ones the
 * ratification named. Those are the contracts here.
 *
 * One test earns its place above all the others: `signatures are type-only`.
 * The first draft of this migration used pg_get_function_identity_arguments,
 * which on PostgreSQL 17 includes PARAMETER NAMES. to_regprocedure() rejects
 * that form and returns NULL — so the migration would have revoked nothing
 * while all four of its assertions passed vacuously. A silent no-op that
 * reports success is the worst possible outcome for a security migration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const MIGRATIONS = join(root, "supabase/migrations");
const NAME = "20260814000001_ops_sec_1_rpc_privilege_lockdown.sql";
const sql = readFileSync(join(MIGRATIONS, NAME), "utf8");

const ADDENDUM = "20260814000002_ops_sec_1_lockdown_addendum.sql";
const add = readFileSync(join(MIGRATIONS, ADDENDUM), "utf8");

const HOTFIX = "20260814000003_ops_sec_1_restore_policy_dependency.sql";
const fix = readFileSync(join(MIGRATIONS, HOTFIX), "utf8");

/** Every quoted `public.fn(...)` signature the migration acts on. */
const signatures = [...sql.matchAll(/'(public\.[a-z_0-9]+\([^']*\))'/g)].map((m) => m[1]);

/** The RLS helpers the ratification excluded from the revoke set. */
const RLS_HELPERS = [
  "auth_tenant_id", "has_permission", "can_read_file", "portal_can_read_file",
  "portal_can_read_shipment", "user_can_read_mailbox", "auth_portal_client_id",
  "messaging_staff_can_access_conversation", "auth_portal_tenant_id",
  "portal_can_read_invoice", "messaging_portal_can_access_conversation",
  "is_assigned_driver", "can_read_task",
];

/** Signatures inside the lockdown loop only — excludes the RLS-helper assertion. */
const lockdownBlock = sql.slice(sql.indexOf("$ops_sec_1$"), sql.indexOf("$assert_rls$"));
const revoked = [...lockdownBlock.matchAll(/'(public\.[a-z_0-9]+)\(/g)].map((m) => m[1]);

describe("OPS-SEC-1 migration exists and is the only new one", () => {
  it("is present in the chain", () => {
    expect(readdirSync(MIGRATIONS)).toContain(NAME);
  });

  it("asserts its OWN effect, not its position in the chain", () => {
    // A marker that claims to be newest breaks the next migration to land.
    expect(sql).not.toMatch(/newest migration|runs LAST|is the last migration/i);
  });
});

describe("it is privilege-only", () => {
  it("changes no function body", () => {
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(sql).not.toMatch(/drop\s+function/i);
    expect(sql).not.toMatch(/alter\s+function/i);
  });

  it("changes no table, policy, trigger or index", () => {
    for (const forbidden of [
      /create\s+table/i, /alter\s+table/i, /drop\s+table/i,
      /create\s+policy/i, /alter\s+policy/i, /drop\s+policy/i,
      /create\s+trigger/i, /drop\s+trigger/i, /create\s+index/i,
    ]) {
      expect(sql, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("writes no data", () => {
    // A privilege migration that INSERTs is not a privilege migration.
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/\bupdate\s+public\./i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });
});

describe("the revoke set is exactly what was ratified", () => {
  it("names all three grantees, because PUBLIC alone is not enough", () => {
    // Hosted Supabase adds EXPLICIT anon/authenticated grants on top of the
    // implicit PUBLIC one. Revoking PUBLIC alone leaves them in force.
    expect(sql).toContain("revoke execute on function %s from public");
    expect(sql).toContain("revoke execute on function %s from anon");
    expect(sql).toContain("revoke execute on function %s from authenticated");
    expect(sql).toContain("grant execute on function %s to service_role");
  });

  it("covers 43 distinct functions", () => {
    expect(new Set(revoked).size).toBe(43);
  });

  it("never revokes a function used by an RLS policy", () => {
    // Policies evaluate as the CALLING role, so revoking authenticated from
    // these would break every policy that calls them rather than harden it.
    for (const helper of RLS_HELPERS) {
      expect(revoked, helper).not.toContain(`public.${helper}`);
    }
  });

  it("never revokes get_user_permissions — the browser calls it", () => {
    expect(revoked).not.toContain("public.get_user_permissions");
  });

  it("asserts the RLS helpers KEEP execute", () => {
    const rlsBlock = sql.slice(sql.indexOf("$assert_rls$"));
    for (const helper of RLS_HELPERS) expect(rlsBlock, helper).toContain(helper);
    expect(rlsBlock).toMatch(/OVER-REVOKED/);
  });
});

describe("the migration cannot pass vacuously", () => {
  it("signatures are type-only, so to_regprocedure() can resolve them", () => {
    // THE bug this suite exists for. `public.f(p_tenant uuid)` returns NULL from
    // to_regprocedure, which would make every revoke a no-op and every
    // assertion below it trivially true.
    expect(signatures.length).toBeGreaterThan(40);
    for (const s of signatures) {
      const args = s.slice(s.indexOf("(") + 1, -1);
      if (args === "") continue;
      for (const arg of args.split(",")) {
        expect(arg.trim(), `parameter name leaked into ${s}`).not.toMatch(/\s/);
      }
    }
  });

  it("ABORTS on an unresolvable signature instead of skipping it", () => {
    expect(sql).toMatch(/signature did not resolve/);
    expect(sql).not.toMatch(/not present, skipped/);
  });

  it("verifies PUBLIC via the ACL, which is the only thing that sees it", () => {
    // has_function_privilege cannot be asked about PUBLIC — it is not a login
    // role — so the ACL check is not redundant with assertion 2.
    expect(sql).toContain("aclexplode");
    expect(sql).toContain("a.grantee = 0");
    expect(sql).toContain("p.proacl is null");
  });

  it("asserts effective privilege for all three roles", () => {
    expect(sql).toContain("has_function_privilege('anon'");
    expect(sql).toContain("has_function_privilege('authenticated'");
    expect(sql).toContain("has_function_privilege('service_role'");
    expect(sql).toMatch(/service_role LOST execute/);
  });

  it("counts what it processed, so a partial run fails", () => {
    expect(sql).toMatch(/expected 43 functions, processed/);
  });
});

describe("the behavioural probe is real and zero-effect", () => {
  it("probes as both anon and authenticated", () => {
    expect(sql).toContain("array['anon','authenticated']");
    expect(sql).toContain("set local role %I");
    expect(sql).toContain("reset role");
  });

  it("treats reaching the function body as FAILURE, not success", () => {
    // insufficient_privilege means refused before the body ran. Anything else
    // means it executed — which is a failed lockdown.
    expect(sql).toContain("when insufficient_privilege then");
    expect(sql).toMatch(/lockdown FAILED/);
  });

  it("passes an invalid decision so the call is inert even if privileged", () => {
    // quotation_validate raises on an unknown decision at its first statement,
    // before any SELECT, UPDATE or emit_business_event.
    expect(sql).toContain("__ops_sec_1_probe__");
  });

  it("raises only AFTER resetting the role", () => {
    const probe = sql.slice(sql.indexOf("$probe$"));
    const reset = probe.indexOf("reset role");
    const raise = probe.indexOf("lockdown FAILED");
    expect(reset).toBeGreaterThan(0);
    expect(raise).toBeGreaterThan(reset);
  });
});

/**
 * The addendum (migration 91).
 *
 * Migration 90 was already applied in production when the two extra functions
 * were ratified, so they land forward-only here rather than by editing an
 * applied migration. Production proved the need: after 90, an anonymous call to
 * next_quotation_number ENTERED THE BODY and attempted an INSERT, stopped only
 * by a foreign key on a nonexistent tenant.
 */
describe("OPS-SEC-1 addendum — the two ratified additions", () => {
  it("does not edit the already-applied migration 90", () => {
    // 90 must still describe exactly what production ran.
    expect(sql).toContain("expected 43 functions, processed");
    expect(sql).not.toContain("next_quotation_number");
    expect(sql).not.toContain("supersede_document");
  });

  it("locks down exactly the two ratified functions", () => {
    expect(add).toContain("'public.next_quotation_number(uuid)'");
    expect(add).toContain("'public.supersede_document(uuid,uuid,uuid,uuid)'");
    expect(add).toContain("expected 2 functions, processed");
  });

  it("is privilege-only, like 90", () => {
    for (const forbidden of [
      /create\s+(or\s+replace\s+)?function/i, /drop\s+function/i, /alter\s+function/i,
      /create\s+table/i, /alter\s+table/i, /create\s+policy/i, /drop\s+policy/i,
      /create\s+trigger/i, /create\s+index/i, /insert\s+into/i, /delete\s+from/i,
    ]) {
      expect(add, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("names all three grantees and preserves service_role", () => {
    expect(add).toContain("revoke execute on function %s from public");
    expect(add).toContain("revoke execute on function %s from anon");
    expect(add).toContain("revoke execute on function %s from authenticated");
    expect(add).toContain("grant execute on function %s to service_role");
  });

  it("uses type-only signatures and aborts on an unresolved one", () => {
    const sigs = [...add.matchAll(/'(public\.[a-z_0-9]+\([^']*\))'/g)].map((m) => m[1]);
    for (const s of sigs) {
      const args = s.slice(s.indexOf("(") + 1, -1);
      if (args === "") continue;
      for (const a of args.split(",")) expect(a.trim(), s).not.toMatch(/\s/);
    }
    expect(add).toMatch(/signature did not resolve/);
  });

  it("re-asserts that it narrowed nothing else", () => {
    // quotation_send is the only caller of next_quotation_number.
    expect(add).toContain("public.quotation_send(uuid,uuid,uuid)");
    expect(add).toContain("public.get_user_permissions(uuid)");
    expect(add).toMatch(/OVER-REVOKED/);
  });

  it("states why its probe is inert, since this one WRITES", () => {
    // Unlike quotation_validate, next_quotation_number has no early guard, so
    // inertness rests on the sentinel tenant AND on the migration aborting.
    expect(add).toMatch(/rolled back with it|aborts the whole transaction/);
    expect(add).toContain("when insufficient_privilege then");
    expect(add).toMatch(/lockdown FAILED/);
  });
});

/**
 * The hotfix (migration 92) — a regression I caused and the lesson from it.
 *
 * Migration 90 revoked user_readable_file_ids from authenticated. can_read_file
 * is SECURITY INVOKER and calls it, so its inner call needed the CALLER to hold
 * EXECUTE; 21 policies across 21 tables started raising 42501 in production.
 *
 * The audit preserved the 13 functions named directly in policy EXPRESSIONS and
 * never followed the call graph one level deeper. Metadata assertions could not
 * catch it, because the 13 were all genuinely fine — what broke was underneath
 * them. Only a behavioural check finds this class of defect.
 */
describe("OPS-SEC-1 hotfix — the transitive policy dependency", () => {
  it("restores the grant to authenticated only", () => {
    expect(fix).toContain(
      "grant execute on function public.user_readable_file_ids(uuid, uuid) to authenticated");
  });

  it("does NOT reopen the anonymous path", () => {
    // The whole point of OPS-SEC-1. anon and PUBLIC must stay revoked.
    expect(fix).not.toMatch(/to\s+anon/);
    expect(fix).toMatch(/anon regained EXECUTE/);
    expect(fix).toMatch(/PUBLIC holds EXECUTE/);
  });

  it("proves the helper evaluates again, rather than trusting metadata", () => {
    // Metadata said the 13 named helpers were fine, and they were. The
    // behavioural probe is what actually catches this class of break.
    expect(fix).toContain("perform public.can_read_file(");
    expect(fix).toMatch(/RLS remains broken/);
  });

  it("generalises the mistake instead of fixing only this instance", () => {
    // Any invoker function calling a denied function is broken the same way.
    expect(fix).toMatch(/SECURITY INVOKER functions still call denied functions/);
    expect(fix).toContain("not p.prosecdef");
  });

  it("raises only AFTER resetting the role", () => {
    const probe = fix.slice(fix.indexOf("$probe$"));
    expect(probe.indexOf("lockdown|RLS remains broken".split("|")[1]))
      .toBeGreaterThan(probe.indexOf("reset role"));
  });

  it("changes no function body, table or policy", () => {
    for (const forbidden of [
      /create\s+(or\s+replace\s+)?function/i, /alter\s+function/i,
      /create\s+table/i, /alter\s+table/i, /create\s+policy/i,
      /insert\s+into/i, /delete\s+from/i,
    ]) {
      expect(fix, String(forbidden)).not.toMatch(forbidden);
    }
  });
});

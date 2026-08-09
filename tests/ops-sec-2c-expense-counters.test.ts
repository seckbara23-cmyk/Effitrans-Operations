/**
 * OPS-SEC-2C — trusted overloads for the two expense counters.
 *
 * Same shape as the 2A pilots, and the same discipline: the overloads are DARK.
 * A migration and a deploy land separately here, so an application caller that
 * needs a not-yet-applied function is an outage waiting for the gap. Activation
 * is a separate step, after this migration is confirmed applied in production.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const MIGRATION = "supabase/migrations/20260816000001_trusted_expense_counters.sql";
const PERSONA = "supabase/tests/ops_sec_2a_trusted_actor_test.sql";
const INVARIANTS = "supabase/tests/ops_sec_2a_catalog_invariants_test.sql";

const sql = read(MIGRATION);
/** Comments stripped: a comment naming an excluded object documents the
 *  exclusion rather than violating it. */
const code = sql.replace(/^\s*--.*$/gm, "");

describe("the trusted expense overloads", () => {
  it("add exactly two overloads and replace nothing", () => {
    const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(new Set(fns)).toEqual(
      new Set(["next_expense_authorization_number", "next_expense_voucher_number"]));
    // The originals must survive: the overloads delegate to them and the
    // deployed application still calls them.
    expect(sql).toContain("return public.next_expense_authorization_number(p_tenant);");
    expect(sql).toContain("return public.next_expense_voucher_number(p_tenant);");
    expect(sql).toContain("an original counter signature disappeared");
  });

  it("asserts finance:expense:submit through the canonical primitive", () => {
    expect(sql).toContain("assert_actor_authority(p_actor, p_tenant, 'finance:expense:submit', 'SERVICE')");
    expect((sql.match(/finance:expense:submit/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("does not reimplement or alter the numbering algorithm", () => {
    // One counter definition. A second would drift and issue duplicates.
    expect(code).not.toMatch(/insert\s+into\s+public\.expense_\w*counter/i);
    expect(code).not.toContain("lpad");
    expect(code).not.toContain("EFT-AUT-");
    expect(code).not.toContain("EFT-BON-");
  });

  it("is privilege-correct: service_role only, all three grantees named", () => {
    for (const s of ["from public", "from anon", "from authenticated", "to service_role"]) {
      expect(sql, s).toContain(s);
    }
    expect(sql).toContain("aclexplode");
  });

  it("proves fail-closed with DATA-INDEPENDENT cases", () => {
    // CI's organization table is empty at migration time; a data-dependent
    // assertion there would pass by accident.
    expect(sql).toContain("DATA-INDEPENDENT");
    expect(sql).toContain("EFA11");
  });

  it("touches nothing excluded from this phase", () => {
    for (const forbidden of ["emit_business_event", "can_read_file", "user_readable_file_ids",
                             "next_file_number", "next_employee_number"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    for (const f of [/create\s+table/i, /alter\s+table/i, /create\s+policy/i,
                     /create\s+trigger/i, /drop\s+function/i]) {
      expect(code, String(f)).not.toMatch(f);
    }
  });

  it("never INVOKES the unratified SYSTEM lane", () => {
    // The migration does contain the literal 'SYSTEM' — in the assertion that
    // forbids it. What must not exist is a CALL passing that lane.
    expect(sql).toContain("references the unratified SYSTEM lane");
    expect(code).not.toMatch(/assert_actor_authority\([^)]*'SYSTEM'/);
    // Every invocation in this migration declares SERVICE.
    const calls = [...code.matchAll(/assert_actor_authority\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c, c).toContain("'SERVICE'");
  });
});

describe("OPS-SEC-2D — the call sites are ACTIVATED onto the trusted overloads", () => {
  const src = read("lib/finance/expense/actions.ts");

  it("both expense counters are invoked with an actor", () => {
    // 2C shipped these dark on purpose: a caller needing a not-yet-applied
    // function is an outage waiting for the gap between migration and deploy.
    // 2D flips them only after migration 94 was confirmed physically present
    // in production.
    const calls = [...src.matchAll(/\.rpc\(\s*"(next_expense_\w+)"[^)]*\)/g)];
    expect(calls.length).toBe(2);
    for (const m of calls) {
      expect(m[0], `${m[1]} still calls the untrusted one-argument signature`)
        .toContain("p_actor");
    }
  });

  it("the actor is session-derived, never taken from request input", () => {
    // ctx comes from guard() -> assertPermission, so userId/tenantId are the
    // authenticated identity. Neither appears in either action's arguments.
    expect(src).toContain("p_actor: ctx.userId");
    expect(src).toContain("p_tenant: ctx.tenantId");
    expect(src).not.toMatch(/p_actor:\s*(input|id|payload)/);
    expect(src).not.toMatch(/p_tenant:\s*(input|id|payload)/);
  });

  it("the TypeScript guard and the database assert the SAME permission", () => {
    // Drift here would have the database verify a different authority than the
    // server action checked — which looks verified and is not.
    expect(src).toContain('guard("finance:expense:submit")');
    expect(sql).toContain("'finance:expense:submit', 'SERVICE'");
  });

  it("no call site selects its own execution context", () => {
    // 'SERVICE' is hard-coded inside the database overload. A caller that could
    // pass a context would be choosing its own trust level.
    expect(src).not.toContain("p_context");
    expect(src).not.toMatch(/["']SYSTEM["']/);
    expect(src).not.toMatch(/["']INTERACTIVE["']/);
  });

  it("the numbering contract module stays pure", () => {
    const n = read("lib/finance/expense/numbering.ts");
    expect(n).not.toContain(".rpc(");
    expect(n).toContain("AUTHORIZATION_NUMBER_PATTERN");
  });

  it("the original one-argument functions are NOT dropped", () => {
    // Out of scope, and the overloads delegate to them. Retiring them is the
    // contract step of expand -> activate -> contract, and it is the only thing
    // that can actually lower INV-7.
    expect(sql).not.toMatch(/drop\s+function/i);
    expect(sql).toContain("an original counter signature disappeared");
  });
});

describe("coverage and invariants", () => {
  const persona = read(PERSONA);
  const inv = read(INVARIANTS);

  it("proves acceptance, not only refusal", () => {
    // A suite where every trusted call fails is not proof of security.
    expect(persona).toContain("expense_authorization_accepted");
    expect(persona).toContain("expense_voucher_accepted");
  });

  it("covers every required rejection", () => {
    for (const c of ["expense_wrong_permission_refused", "expense_cross_tenant_refused",
                     "expense_forged_actor_refused", "expense_inactive_actor_refused"]) {
      expect(persona, c).toContain(c);
    }
  });

  it("proves a rejection consumes no number and formats are unchanged", () => {
    expect(persona).toContain("rejected_authorization_consumed_no_number");
    expect(persona).toContain("rejected_voucher_consumed_no_number");
    expect(persona).toContain("authorization_format_unchanged");
    expect(persona).toContain("voucher_format_unchanged");
  });

  it("extends INV-6 and INV-8 to the expense pair", () => {
    expect(inv).toContain("public.next_expense_authorization_number(uuid,uuid)");
    expect(inv).toContain("public.next_expense_voucher_number(uuid,uuid)");
    expect(inv).toContain("finance:expense:submit");
  });

  it("keeps INV-7 at 50 and EXPLAINS why rather than adjusting it", () => {
    // The ceiling cannot fall while the untrusted originals survive; lowering
    // it would record a fiction the next honest re-count would fail on.
    expect(inv).toContain("count(*) <= 50");
    expect(inv).toContain("WHY THE CEILING IS STILL 50");
  });

  it("adds INV-10 so progress is provable and monotonic", () => {
    expect(inv).toContain("INV-10");
    expect(inv).toContain("count(*) >= 4");
  });

  it("leaves the OPS-SEC-1 and 2B protections intact", () => {
    expect(inv).toContain("can_read_file"); // the named P2 exception survives
    expect(inv).toContain("INV-4");         // transitive INVOKER protection
    expect(inv).toContain("public.next_file_number(uuid,text,uuid)");
    expect(inv).toContain("public.next_employee_number(uuid,uuid)");
  });
});

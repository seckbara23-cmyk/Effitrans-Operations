/**
 * Handoff-receiver read visibility (FIN-UAT Failure B) — migration 121.
 * ---------------------------------------------------------------------------
 * The behavioural proof lives in SQL (`rls_handoff_receiver_visibility_test.sql`,
 * run against a real Postgres in CI) because the rule IS a database function.
 * These cases pin the contract around it: the migration says what it must say,
 * the ledger knows it exists, the bridge is a declarative registry projection
 * rather than a stale column, and — the one that matters most — the application
 * scope and RLS cannot drift apart, because they are literally the same function.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "@/lib/platform/ops/build-info";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const MIGRATION = "20260913000001_handoff_receiver_visibility";
const sql = read(`../supabase/migrations/${MIGRATION}.sql`);
const visibility = read("../lib/authz/visibility.ts");
const suite = read("../supabase/tests/rls_handoff_receiver_visibility_test.sql");
const ci = read("../.github/workflows/ci.yml");

/** The `user_readable_file_ids` body only — not the assertions that quote it. */
function fnSlice(): string {
  const start = sql.indexOf("create or replace function public.user_readable_file_ids");
  const end = sql.indexOf("grant execute on function public.user_readable_file_ids", start);
  expect(start, "function not found").toBeGreaterThan(-1);
  expect(end, "slice boundary moved").toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("migration 121 — handoff-receiver visibility", () => {
  it("is registered in the build ledger", () => {
    expect(LATEST_MIGRATION).toBe(MIGRATION);
    expect(MIGRATION_COUNT).toBe(121);
  });

  it("widens visibility without losing a single existing ground", () => {
    const fn = fnSlice();
    for (const ground of [
      "gp.code = 'file:read:all'",
      "f.account_manager_id = p_user",
      "f.coordinator_id = p_user",
      "f.created_by = p_user",
      "t.assigned_to = p_user",
    ]) {
      expect(fn, ground).toContain(ground);
    }
  });

  it("grants ONLY on an OPEN handoff, never on department membership alone", () => {
    const fn = fnSlice();
    expect(fn).toContain("h.status = 'SENT'");
    // The dossier must be the one handed over — the join is on THIS file.
    expect(fn).toContain("where pi.file_id = f.id");
    // Role membership alone is insufficient: the handoff join is mandatory.
    expect(fn).toContain("public.process_handoff h");
    expect(fn).toContain("public.process_step_receiving_role sr");
  });

  it("does NOT use the stale execution role code as the authority", () => {
    // The whole reason the bridge table exists.
    expect(fnSlice()).not.toContain("assigned_role_code");
    expect(sql).toContain("REJECTED as the authority");
  });

  it("keeps tenant isolation on every join", () => {
    const fn = fnSlice();
    expect(fn).toContain("f.tenant_id = p_tenant");
    for (const pin of [
      "pi.tenant_id = p_tenant",
      "r.tenant_id = p_tenant",
      "ur.tenant_id = p_tenant",
      "h.tenant_id = p_tenant",
    ]) {
      expect(fn, pin).toContain(pin);
    }
  });

  it("maps the legacy step key to the RATIFIED Transit receiver, and excludes SYSTEM_ADMIN", () => {
    expect(sql).toMatch(/\('coordinator_reception',\s*'CHIEF_OF_TRANSIT'/);
    // SYSTEM_ADMIN reads via file:read:all; listing it here would misattribute that.
    const seed = sql.slice(sql.indexOf("insert into public.process_step_receiving_role"), sql.indexOf("on conflict (step_key, role_code)"));
    expect(seed).not.toContain("SYSTEM_ADMIN");
    // …and the migration refuses to install if that ever changes.
    expect(sql).toContain("MIGRATION FAILED: SYSTEM_ADMIN must not derive visibility from the handoff clause");
  });

  it("grants READ only — the bridge is never a source of mutation authority", () => {
    expect(sql).toContain("grant select on public.process_step_receiving_role to authenticated, service_role");
    expect(sql).not.toMatch(/grant\s+(insert|update|delete)/i);
    expect(sql).toContain("Never a source of mutation authority");
  });

  it("application scope and RLS cannot disagree — they are the same function", () => {
    // resolveFileScope does not re-implement the predicate; it calls the RPC.
    expect(visibility).toContain('supabase.rpc("user_readable_file_ids"');
    expect(visibility).not.toContain("process_handoff");
    expect(visibility).not.toContain("account_manager_id");
    // isFileVisible is derived from the same scope.
    expect(visibility).toContain("const scope = await resolveFileScope(userId, tenantId, \"file:read:all\")");
  });

  it("the behavioural suite exists and CI runs it", () => {
    for (const proof of [
      "FAIL 1: Chef de Transit cannot read a dossier handed to Transit",
      "FAIL 2: Transit staff gained blanket visibility",
      "FAIL 3: an unauthorized role obtained handoff visibility",
      "FAIL 4a: cross-tenant read via handoff",
      "FAIL 5: visibility survived reception",
      "FAIL 6: created_by visibility regressed",
    ]) {
      expect(suite, proof).toContain(proof);
    }
    // The stale-column trap is deliberately planted in the fixture.
    expect(suite).toContain("'coordinator_reception', 'PENDING', 'COORDINATOR'");
    expect(ci).toContain("supabase/tests/rls_handoff_receiver_visibility_test.sql");
  });
});

/**
 * F-1 — responsibility-derived dossier read visibility (migration 122).
 * ---------------------------------------------------------------------------
 * Behaviour is proven in SQL against a real Postgres in CI
 * (`rls_responsibility_visibility_test.sql`) because the rule IS a database
 * function. These cases pin the contract: the ground exists with both of its
 * limits, EVERY prior ground survives, the seed is a faithful registry
 * projection with no invented managerial access, and the ledger knows about it.
 *
 * The exhaustive prior-ground list is mandatory, not stylistic: migration 121
 * silently deleted four grounds while its own assertions passed, because they
 * asserted only the subset it had copied.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "@/lib/platform/ops/build-info";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { ROLE_MAPPINGS } from "@/lib/process/roles";
import { OPEN_STATES } from "@/lib/process/engine/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const MIGRATION = "20260914000001_responsibility_visibility";
const sql = read(`../supabase/migrations/${MIGRATION}.sql`);
const suite = read("../supabase/tests/rls_responsibility_visibility_test.sql");
const ci = read("../.github/workflows/ci.yml");
const visibility = read("../lib/authz/visibility.ts");

/** The function body only — never the assertions below it that quote it. */
function fnSlice(): string {
  const start = sql.indexOf("create or replace function public.user_readable_file_ids");
  const end = sql.indexOf("grant execute on function public.user_readable_file_ids", start);
  expect(start, "function not found").toBeGreaterThan(-1);
  expect(end, "slice boundary moved").toBeGreaterThan(start);
  return sql.slice(start, end);
}
/** The NEW disjunct only — bounded so prior clauses cannot satisfy its pins. */
function newGroundSlice(): string {
  const fn = fnSlice();
  const start = fn.indexOf("process_step_owning_role");
  expect(start, "new ground not found").toBeGreaterThan(-1);
  return fn.slice(fn.lastIndexOf("or exists", start), fn.indexOf("    );", start));
}
/** The seed statement only. */
function seedSlice(): string {
  const start = sql.indexOf("insert into public.process_step_owning_role");
  const end = sql.indexOf("on conflict (step_key, role_code)", start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
}

describe("F-1 — the new ground and its two limits", () => {
  it("exists and is counted by the build ledger", () => {
    // NOT pinned as "the latest": 122 stopped being newest when C-3 landed as
    // 123, and a frozen latest-migration literal is a test that expires. What
    // matters is that THIS migration exists and the ledger counts it.
    expect(sql.length).toBeGreaterThan(0);
    expect(MIGRATION_COUNT).toBeGreaterThanOrEqual(122);
    expect(LATEST_MIGRATION >= MIGRATION).toBe(true);
  });

  it("grants on an OPEN step owned by a role the user holds — in this tenant", () => {
    const g = newGroundSlice();
    expect(g).toContain("public.process_step_execution ex");
    expect(g).toContain("public.process_step_owning_role sor");
    expect(g).toContain("where pi3.file_id = f.id");
    // WORD-ANCHORED. `toContain("r3.tenant_id = p_tenant")` is satisfied by the
    // SUBSTRING inside `ur3.tenant_id = p_tenant`, so deleting the role pin — a
    // cross-tenant leak — passed the first version of this test. Caught by
    // mutation M4; every alias pin is now bounded by a word boundary.
    for (const alias of ["pi3", "r3", "ur3", "ex"]) {
      expect(g, `${alias}.tenant_id`).toMatch(new RegExp(`\\b${alias}\\.tenant_id = p_tenant`));
    }
    expect(g).toMatch(/\bur3\.user_id = p_user/);
  });

  it("LIMIT 1 — assignee narrowing: the ground excludes claimed steps", () => {
    expect(newGroundSlice()).toContain("ex.assigned_user_id is null");
    // Narrowing is by SUBTRACTION: the assignee's own access is the pre-existing
    // WES-3B ground, so there is no second rule to keep in step.
    expect(fnSlice()).toContain("e.assigned_user_id = p_user");
    expect(sql).toContain("achieved by subtraction");
  });

  it("LIMIT 2 — bounded to OPEN states, so responsibility expires", () => {
    const g = newGroundSlice();
    expect(g).toContain("ex.state in ('AVAILABLE', 'ACTIVE', 'BLOCKED', 'SUBMITTED')");
    // Exactly the engine's own OPEN_STATES — no drift, no extra state.
    for (const s of OPEN_STATES) expect(g, s).toContain(`'${s}'`);
    for (const terminal of ["COMPLETED", "SKIPPED", "REJECTED", "CANCELLED", "PENDING"]) {
      expect(g, terminal).not.toContain(`'${terminal}'`);
    }
  });

  it("grants READ only — no mutation capability anywhere in the migration", () => {
    expect(sql).toContain("grant select on public.process_step_owning_role to authenticated, service_role");
    expect(sql).not.toMatch(/grant\s+(insert|update|delete)/i);
    expect(sql).toContain("never mutation authority");
  });
});

describe("F-1 — every pre-existing ground survives (121's regression as a test)", () => {
  it("all ten prior grounds are present in the rebuilt function", () => {
    const fn = fnSlice();
    for (const ground of [
      "gp.code = 'file:read:all'",
      "f.account_manager_id = p_user",
      "f.coordinator_id = p_user",
      "f.created_by = p_user",
      "pi.owner_user_id = p_user",
      "t.assigned_to = p_user",
      "e.assigned_user_id = p_user",
      "assignment_event ae",
      "CUSTOMS_FIELD_AGENT",
      "process_step_receiving_role",
    ]) {
      expect(fn, ground).toContain(ground);
    }
    // 121's clause keeps its own limit too.
    expect(fn).toContain("h.status = 'SENT'");
  });

  it("the migration refuses to install if any ground is lost", () => {
    for (const msg of [
      "lost ground file:read:all",
      "lost ground account_manager_id",
      "lost ground coordinator_id",
      "lost ground created_by",
      "lost ground WES-3G operational ownership",
      "lost ground task.assigned_to",
      "lost ground WES-3B step assignee",
      "lost ground assignment_event history",
      "lost ground customs department involvement",
      "lost ground 121 handoff-receiver visibility",
      "assignee narrowing absent",
      "not bounded to OPEN states",
    ]) {
      expect(sql, msg).toContain(msg);
    }
  });

  it("was built from the LIVE definition, and says so", () => {
    expect(sql).toContain("read back from production with pg_get_functiondef");
  });
});

describe("F-1 — the seed is a faithful registry projection", () => {
  it("carries exactly one row per official step, with the registry's own role", () => {
    const seed = seedSlice();
    const pairs = [...seed.matchAll(/\('([a-z_]+)',\s*'([A-Z_]+)'/g)].map((m) => [m[1], m[2]]);
    expect(pairs).toHaveLength(EFFITRANS_PROCESS.length);
    expect(EFFITRANS_PROCESS.length).toBe(26);

    const tenantRoleFor = (officialRole: string) =>
      ROLE_MAPPINGS.find((r) => r.officialRole === officialRole)?.tenantRole ?? officialRole;
    for (const step of EFFITRANS_PROCESS) {
      const row = pairs.find(([k]) => k === step.key);
      expect(row, `no seed row for ${step.key}`).toBeTruthy();
      expect(row![1], `${step.key} owning role`).toBe(tenantRoleFor(step.role));
    }
  });

  it("invents NO managerial access — one role per step, oversight not added", () => {
    const seed = seedSlice();
    const byStep = new Map<string, number>();
    for (const m of seed.matchAll(/\('([a-z_]+)',\s*'([A-Z_]+)'/g)) {
      byStep.set(m[1], (byStep.get(m[1]) ?? 0) + 1);
    }
    for (const [step, n] of byStep) expect(n, `${step} has more than one owning role`).toBe(1);
    // Supervisory codes appear ONLY where the registry itself names them.
    const registryRoles = new Set(
      EFFITRANS_PROCESS.map((s) => ROLE_MAPPINGS.find((r) => r.officialRole === s.role)?.tenantRole ?? s.role),
    );
    for (const m of seed.matchAll(/'([A-Z_]+)'/g)) {
      expect(registryRoles.has(m[1]), `${m[1]} is not an owning role in the registry`).toBe(true);
    }
    expect(sql).toContain("Supervisory roles are NOT added here");
  });

  it("maps the two audited dead zones and the ratified Transit reception", () => {
    const seed = seedSlice();
    expect(seed).toMatch(/\('coordinator_completeness',\s*'COORDINATOR'/);   // FD-1
    expect(seed).toMatch(/\('courier_deposit',\s*'COURIER'/);                // FD-2
    expect(seed).toMatch(/\('coordinator_reception',\s*'CHIEF_OF_TRANSIT'/); // ratified
  });
});

describe("F-1 — proof harness", () => {
  it("the SQL suite covers every required case and CI runs it", () => {
    for (const proof of [
      "FAIL R1/FD-1", "FAIL R2", "FAIL R3", "FAIL R4", "FAIL R5", "FAIL R6",
      "FAIL R7a", "FAIL R7b", "FAIL R7c", "FAIL FD-2",
      "FAIL G1", "FAIL G2", "FAIL G3",
    ]) {
      expect(suite, proof).toContain(proof);
    }
    expect(ci).toContain("supabase/tests/rls_responsibility_visibility_test.sql");
  });

  it("application scope and RLS still cannot diverge", () => {
    expect(visibility).toContain('supabase.rpc("user_readable_file_ids"');
    expect(visibility).not.toContain("process_step_owning_role");
  });
});

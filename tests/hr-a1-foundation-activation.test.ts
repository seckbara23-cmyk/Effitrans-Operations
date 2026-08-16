/**
 * HR-A1 — Foundation activation (HRQ-D2 = Option A, ratified 2026-08-09).
 * ---------------------------------------------------------------------------
 * The phase is an ACTIVATION, not a build: one grant (hr:config:manage →
 * HR_OFFICER), the ratified matricule scheme (EMP-0001, continuous, no year),
 * the F1 registry fix (all HR tables visible to the tenant-scope guard), and
 * wizard preparation. What these tests pin:
 *
 *   1. the grant exists in ALL THREE sources (migration → production,
 *      seed.sql → CI, role template → provisioning) and NOWHERE else — the
 *      EC-3B "three sources" lesson applied to granting;
 *   2. the three OTHER parked authorities stay granted to NOBODY, asserted on
 *      DATA (template objects, parsed seed grant blocks), never by word
 *      blacklist — comments legitimately name the parked codes;
 *   3. every table the HR migrations create is registered in
 *      TENANT_SCOPED_TABLES (HR-0P F1: an unregistered table is INVISIBLE to
 *      the leak guard, not flagged by it);
 *   4. the migration seeds NO organizational data — configuration is an
 *      operator UI session, never SQL;
 *   5. organizational placement grants nothing: the RBAC resolution path
 *      never reads the HR tables.
 *
 * The DATABASE half (grant state, EMP-0001 allocation, tenant isolation,
 * refusal-burns-nothing) lives in supabase/tests/
 * hr_a1_foundation_activation_test.sql; here we pin that the suite keeps its
 * core checks and stays wired into CI.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TENANT_SCOPED_TABLES, GLOBAL_TABLES } from "@/lib/db/tenant-tables";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
}

const MIGRATION = read("supabase/migrations/20260821000001_hr_a1_foundation_activation.sql");
const SEED = read("supabase/seed.sql");
const SUITE = read("supabase/tests/hr_a1_foundation_activation_test.sql");
const STUDIO = read("components/hr/configuration-studio.tsx");
const FILE_ACTIONS = read("lib/hr/employee-file-actions.ts");

// HR-B1 unparked hr:leave:approve (migration 108) and HR-B2 unparked
// hr:performance:finalize (migration 109), both onto the Direction seats.
// ONE authority remains parked; the two activated seats are pinned below.
const PARKED = ["hr:sensitive:read"];
const DIRECTION_SEATS = ["DGA", "DAF"];
const DIRECTION_CODES = ["hr:leave:approve", "hr:performance:finalize"];

/** role_permission grant blocks in seed.sql (the role-templates.test.ts idiom). */
function seedGrantBlocks(): string[] {
  return SEED.match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? [];
}

// ===========================================================================
describe("HRQ-D2 Option A — the grant exists in all three sources", () => {
  it("migration 99 grants hr:config:manage to HR_OFFICER and only HR_OFFICER", () => {
    expect(MIGRATION).toMatch(/insert into public\.role_permission[\s\S]*?p\.code = 'hr:config:manage'[\s\S]*?r\.code = 'HR_OFFICER'/);
    // Idempotent — reapplying the grant can never fail.
    expect(MIGRATION).toContain("on conflict do nothing");
  });

  it("seed.sql mirrors the grant inside the HR_OFFICER block", () => {
    const hrBlocks = seedGrantBlocks().filter((b) => b.includes("'HR_OFFICER'"));
    expect(hrBlocks.length).toBeGreaterThan(0);
    expect(hrBlocks.some((b) => b.includes("'hr:config:manage'"))).toBe(true);
  });

  it("the provisioning template mirrors the grant", () => {
    const hr = TENANT_ROLE_TEMPLATES.find((t) => t.key === "HR_OFFICER");
    expect(hr).toBeDefined();
    expect(hr!.permissions).toContain("hr:config:manage");
  });

  it("no OTHER template gains any hr:* — SYSTEM_ADMIN included (DEC-B25)", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      if (t.key === "HR_OFFICER") continue;
      // HR-B1/HR-B2: the Direction seats hold exactly the two activated
      // authorities, and no other template holds any hr:* at all.
      const expected = DIRECTION_SEATS.includes(t.key) ? DIRECTION_CODES : [];
      expect(
        t.permissions.filter((p) => p.startsWith("hr:")).sort(),
        `${t.key} hr:* grants`,
      ).toEqual([...expected].sort());
    }
  });
});

// ===========================================================================
describe("the three parked authorities stay parked (asserted on DATA)", () => {
  it("no template grants any parked code", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      for (const code of PARKED) {
        expect(t.permissions, `${t.key} must not hold ${code}`).not.toContain(code);
      }
    }
  });

  it("no seed grant block grants any parked code; the leave seat goes to Direction only", () => {
    for (const block of seedGrantBlocks()) {
      for (const code of PARKED) {
        expect(block).not.toContain(`'${code}'`);
      }
      for (const activated of DIRECTION_CODES) {
        if (block.includes(`'${activated}'`)) {
          expect(block, activated).toContain("'DAF', 'DGA'");
          expect(block, activated).not.toContain("'CEO'");
        }
      }
    }
  });

  it("the migration ASSERTS the pause instead of assuming it", () => {
    // The migration refuses to complete if a parked authority acquired a grant
    // or SYSTEM_ADMIN acquired hr:* — the pause is proven at apply time.
    expect(MIGRATION).toMatch(/p\.code in \('hr:sensitive:read', 'hr:leave:approve', 'hr:performance:finalize'\)[\s\S]*?raise exception/);
    expect(MIGRATION).toMatch(/r\.code = 'SYSTEM_ADMIN' and p\.code like 'hr:%'[\s\S]*?raise exception/);
  });
});

// ===========================================================================
describe("F1 — every HR table is visible to the tenant-scope guard", () => {
  const HR_MIGRATIONS = [
    "supabase/migrations/20260724000002_hr_employee_registry.sql",
    "supabase/migrations/20260801000001_hr_organization_foundation.sql",
    "supabase/migrations/20260801000002_hr_employee_workspace.sql",
    "supabase/migrations/20260802000001_hr_documents_contracts.sql",
    "supabase/migrations/20260802000002_hr_onboarding_equipment.sql",
    "supabase/migrations/20260802000003_hr_leave_attendance.sql",
    "supabase/migrations/20260803000001_hr_performance.sql",
    "supabase/migrations/20260803000002_hr_training.sql",
  ];

  /** Every table those migrations create. */
  function createdTables(): string[] {
    const names = new Set<string>();
    for (const f of HR_MIGRATIONS) {
      for (const m of read(f).matchAll(/create table (?:if not exists )?public\.(\w+)/g)) {
        names.add(m[1]);
      }
    }
    return [...names];
  }

  it("the HR migrations create 36 tables and EVERY one is registered", () => {
    const tables = createdTables();
    expect(tables).toHaveLength(36);
    for (const t of tables) {
      expect(TENANT_SCOPED_TABLES.has(t), `${t} must be in TENANT_SCOPED_TABLES`).toBe(true);
      expect(GLOBAL_TABLES.has(t), `${t} must NOT be exempted as global`).toBe(false);
    }
  });

  it("hr_document_type is tenant-scoped, NOT a global catalog", () => {
    // Unlike document_type (global reference catalog), hr_document_type carries
    // tenant_id — the two must never be conflated.
    expect(TENANT_SCOPED_TABLES.has("hr_document_type")).toBe(true);
    expect(GLOBAL_TABLES.has("document_type")).toBe(true);
  });

  it("the guard finding is fixed CLOSED: the C3 class read is tenant-scoped and refuses on absence", () => {
    const fn = FILE_ACTIONS.slice(
      FILE_ACTIONS.indexOf("export async function getEmployeeDocumentUrl"),
      FILE_ACTIONS.indexOf("export async function deleteEmployeeDocument"),
    );
    expect(fn).toMatch(/from\("hr_document_type"\)[\s\S]*?\.eq\("tenant_id", admin\.tenantId\)/);
    // Missing type row → refusal, never "not C3, mint the URL anyway".
    expect(fn).toMatch(/if \(!type\) return \{ ok: false/);
    expect(fn).toMatch(/data_class === "C3"/);
  });
});

// ===========================================================================
describe("the ratified matricule scheme EMP-0001", () => {
  it("the migration re-points the SAME engine — no second counter, no year", () => {
    const fnBody = MIGRATION.slice(
      MIGRATION.indexOf("create or replace function public.next_employee_number"),
      MIGRATION.indexOf("revoke execute on function public.next_employee_number"),
    );
    expect(fnBody).toContain("insert into public.employee_counter");
    expect(fnBody).toContain("on conflict (tenant_id, year)");
    expect(fnBody).not.toContain("extract(year");
    expect(fnBody).toContain("employee_number_prefix");
    expect(fnBody).toContain("'EMP'");
    expect(fnBody).toContain("lpad(v_seq::text, 4, '0')");
    // Definer function invariants (INV-2/INV-3): pinned path, no dynamic SQL.
    expect(fnBody).toContain("security definer");
    expect(fnBody).toContain("set search_path = public");
    expect(fnBody.toLowerCase()).not.toMatch(/\bexecute\b/);
    // The migration creates NO table — the engine is reused, never duplicated.
    expect(MIGRATION).not.toMatch(/create table/i);
  });

  it("browser roles stay revoked; only service_role may allocate", () => {
    expect(MIGRATION).toContain("revoke execute on function public.next_employee_number(uuid) from anon");
    expect(MIGRATION).toContain("revoke execute on function public.next_employee_number(uuid) from authenticated");
    expect(MIGRATION).toContain("grant execute on function public.next_employee_number(uuid) to service_role");
  });

  it("the SQL suite proves the format, isolation and refusal behaviour", () => {
    expect(SUITE).toContain("'EMP-0001'");
    expect(SUITE).toContain("'EMP-0002'");
    expect(SUITE).toMatch(/tenant B sequence is independent/);
    expect(SUITE).toMatch(/refusal burned no number/);
    expect(SUITE).toMatch(/prefix change never resets|sequence continues/i);
    expect(SUITE).toContain("trg_employee_number_immutable");
  });

  it("the studio states the ratified format to the operator", () => {
    expect(STUDIO).toContain("EMP-0001");
    expect(STUDIO).toMatch(/séquence continue/);
  });
});

// ===========================================================================
describe("activation is an operator UI session — never SQL seed data", () => {
  it("the migration inserts NO organizational or employee data", () => {
    // The ONLY insert in migration 99 is the role_permission grant.
    const inserts = [...MIGRATION.matchAll(/insert into public\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(inserts)).toEqual(new Set(["role_permission", "employee_counter"]));
    // …and the employee_counter insert lives INSIDE the numbering function
    // (the allocation upsert), not as seed data at migration time.
    const fnBody = MIGRATION.slice(
      MIGRATION.indexOf("create or replace function"),
      MIGRATION.indexOf("revoke execute"),
    );
    expect(fnBody).toContain("insert into public.employee_counter");
    const outsideFn = MIGRATION.replace(fnBody, "");
    expect(outsideFn).not.toContain("insert into public.employee_counter");
  });

  it("the wizard reuses THE canonical department registry — no competing vocabulary", () => {
    expect(STUDIO).toContain('from "@/lib/organization/departments"');
    expect(STUDIO).toContain("CANONICAL_DEPARTMENTS.map");
    // The hardcoded copy of the four codes is gone from the select.
    expect(STUDIO).not.toMatch(/\[\s*"OPERATIONS",\s*"TRANSIT",\s*"FINANCE",\s*"HUMAN_RESOURCES"\s*\]/);
    // The registry is what the operator sees, labeled in French.
    expect(CANONICAL_DEPARTMENTS.map((d) => d.code)).toEqual([
      "OPERATIONS", "TRANSIT", "FINANCE", "HUMAN_RESOURCES",
    ]);
  });

  it("the studio says what the correspondence is NOT: an access grant", () => {
    expect(STUDIO).toMatch(/n(&apos;|')accorde\s+jamais aucun droit/);
  });
});

// ===========================================================================
describe("organizational placement grants NOTHING (the HR-0P invariant)", () => {
  it("the RBAC resolution path never reads HR tables", () => {
    for (const rel of ["lib/rbac/permissions.ts", "lib/rbac/check.ts", "lib/auth/require-permission.ts"]) {
      const src = read(rel);
      for (const table of ["employee", "hr_org_unit", "employee_assignment", "hr_position"]) {
        expect(src, `${rel} must not read ${table}`).not.toMatch(new RegExp(`from\\("${table}"\\)`));
      }
    }
  });

  it("the SQL suite proves it at the database layer too", () => {
    expect(SUITE).toMatch(/RBAC never reads employee\/org-unit\/assignment tables/);
  });

  it("account linking still grants nothing — the registry migration is untouched", () => {
    const hr1 = read("supabase/migrations/20260724000002_hr_employee_registry.sql");
    expect(hr1).toContain("linked_app_user_id");
    expect(hr1).toContain("grants NO role/permission");
  });
});

// ===========================================================================
describe("the DB suite is wired into CI", () => {
  it("suite exists and CI runs it", () => {
    expect(SUITE.length).toBeGreaterThan(0);
    expect(read(".github/workflows/ci.yml")).toContain("-f supabase/tests/hr_a1_foundation_activation_test.sql");
  });
});

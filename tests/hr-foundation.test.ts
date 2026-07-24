/**
 * Phase HR-1 — Employee Registry foundation.
 * ---------------------------------------------------------------------------
 * Proves the ratified HR-0 decisions (DEC-B23..B27) hold in code:
 *   * a real employee record separate from accounts, with an optional
 *     grants-nothing account link;
 *   * pure employment lifecycle (rehire = new record; no TERMINATED→ACTIVE);
 *   * SYSTEM_ADMIN holds no hr:* (the grant matrix is HR_OFFICER-only);
 *   * no salary/national-ID/medical field exists;
 *   * audit payloads carry no contact values (redaction);
 *   * « Ressources humaines » is a MANAGEMENT item gated hr:read, not a
 *     DÉPARTEMENTS entry;
 *   * every mutation is permission-gated + tenant-scoped and never writes
 *     user_role or bans an account.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  EMPLOYEE_STATUSES,
  canTransitionEmployee,
  nextEmployeeStatuses,
  terminationRequiresReason,
  isEmployeeStatus,
  employeeStatusLabelFr,
} from "@/lib/hr/lifecycle";
import { validateEmployeeInput, EMPLOYMENT_TYPES } from "@/lib/hr/validate";
import { TENANT_ROLE_KEYS, getTenantRoleTemplate } from "@/lib/platform/role-templates";
import { roleCanonicalDepartment } from "@/lib/organization/departments";
import { roleLabel, ROLE_DISPLAY_PRIORITY } from "@/lib/navigation/roles";
import { navSections } from "@/lib/nav";
import { isTenantScopedTable } from "@/lib/db/tenant-tables";
import { LATEST_MIGRATION, MIGRATION_PROBE } from "@/lib/platform/ops/build-info";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
const stripJs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const migration = stripSql(read("../supabase/migrations/20260724000002_hr_employee_registry.sql"));
const migrationRaw = read("../supabase/migrations/20260724000002_hr_employee_registry.sql");
const seed = read("../supabase/seed.sql");
const actions = read("../lib/hr/actions.ts");
const readMod = read("../lib/hr/read.ts");
const registryPage = read("../app/departments/hr/page.tsx");
const profilePage = read("../app/departments/hr/[id]/page.tsx");
const rls = read("../supabase/tests/rls_hr_employee_test.sql");

// Data the platform must NEVER hold in HR-1 (DEC-B27).
const FORBIDDEN_COLUMNS = ["salary", "compensation", "national_id", "passport", "date_of_birth", "gender", "marital", "medical"];

// ============================================ pure lifecycle (1-8) ====
describe("employment lifecycle (pure, DEC-B26)", () => {
  it("1 — has exactly the five ratified states", () => {
    expect([...EMPLOYEE_STATUSES]).toEqual(["DRAFT", "ACTIVE", "SUSPENDED", "TERMINATED", "ARCHIVED"]);
  });
  it("2 — DRAFT may activate or be archived", () => {
    expect(nextEmployeeStatuses("DRAFT")).toEqual(["ACTIVE", "ARCHIVED"]);
  });
  it("3 — ACTIVE ⇄ SUSPENDED and ACTIVE → TERMINATED", () => {
    expect(canTransitionEmployee("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionEmployee("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionEmployee("ACTIVE", "TERMINATED")).toBe(true);
  });
  it("4 — rehire = new record: TERMINATED NEVER returns to ACTIVE", () => {
    expect(canTransitionEmployee("TERMINATED", "ACTIVE")).toBe(false);
    expect(nextEmployeeStatuses("TERMINATED")).toEqual(["ARCHIVED"]);
  });
  it("5 — ARCHIVED is terminal", () => {
    expect(nextEmployeeStatuses("ARCHIVED")).toEqual([]);
  });
  it("6 — no skipping DRAFT straight to TERMINATED/SUSPENDED", () => {
    expect(canTransitionEmployee("DRAFT", "TERMINATED")).toBe(false);
    expect(canTransitionEmployee("DRAFT", "SUSPENDED")).toBe(false);
  });
  it("7 — only TERMINATED requires a reason", () => {
    expect(terminationRequiresReason("TERMINATED")).toBe(true);
    expect(terminationRequiresReason("SUSPENDED")).toBe(false);
  });
  it("8 — status guard + French labels", () => {
    expect(isEmployeeStatus("ACTIVE")).toBe(true);
    expect(isEmployeeStatus("ON_LEAVE")).toBe(false); // derived later, never a status
    expect(employeeStatusLabelFr("ACTIVE")).toBe("Actif");
  });
});

// ============================================ validation (9-13) ====
describe("employee validation (pure)", () => {
  it("9 — requires first name, last name, canonical department", () => {
    expect(validateEmployeeInput({}).length).toBeGreaterThan(0);
    expect(validateEmployeeInput({ firstName: "A", lastName: "B", department: "OPERATIONS" })).toEqual([]);
  });
  it("10 — rejects a non-canonical department", () => {
    expect(validateEmployeeInput({ firstName: "A", lastName: "B", department: "MARKETING" }).length).toBeGreaterThan(0);
  });
  it("11 — validates email shape", () => {
    expect(validateEmployeeInput({ firstName: "A", lastName: "B", department: "FINANCE", professionalEmail: "nope" }).length).toBeGreaterThan(0);
  });
  it("12 — probation cannot precede hire", () => {
    expect(validateEmployeeInput({ firstName: "A", lastName: "B", department: "FINANCE", hireDate: "2026-06-01", probationEndDate: "2026-05-01" }).length).toBeGreaterThan(0);
  });
  it("13 — partial mode skips required-field checks", () => {
    expect(validateEmployeeInput({ firstName: "x" }, { partial: true })).toEqual([]);
    expect(validateEmployeeInput({}, { partial: true })).toEqual([]);
    expect(EMPLOYMENT_TYPES).toContain("CDI");
  });
});

// ============================================ migration shape (14-22) ====
describe("migration — employee registry structure", () => {
  it("14 — creates the employee table + its counter, and nothing else data-bearing", () => {
    expect(migration).toMatch(/create table public\.employee\b/);
    expect(migration).toMatch(/create table public\.employee_counter\b/);
    // exactly two CREATE TABLE statements in this migration
    expect((migration.match(/create table /g) ?? []).length).toBe(2);
  });
  it("15 — holds NO salary/national-ID/medical/DOB column (DEC-B27)", () => {
    for (const col of FORBIDDEN_COLUMNS) {
      expect(migration.toLowerCase(), col).not.toContain(col);
    }
  });
  it("16 — RLS: enabled with a single SELECT policy gated on hr:read, no FORCE, no portal policy", () => {
    expect(migration).toMatch(/alter table public\.employee enable row level security/);
    expect(migration).toMatch(/create policy employee_select on public\.employee\s+for select/);
    expect(migration).toContain("has_permission('hr:read')");
    expect(migration).not.toMatch(/force row level security/i);
    expect(migration.toLowerCase()).not.toContain("portal"); // customers never read HR
    // exactly one policy on employee
    expect((migration.match(/create policy .* on public\.employee/g) ?? []).length).toBe(1);
  });
  it("17 — one-account-per-employee via a partial unique index", () => {
    expect(migration).toMatch(/create unique index uq_employee_linked_user on public\.employee \(linked_app_user_id\)\s*where linked_app_user_id is not null/);
  });
  it("18 — a tenant-integrity trigger guards linked account, manager, creator", () => {
    expect(migration).toMatch(/function public\.enforce_employee_tenant/);
    expect(migration).toMatch(/create trigger trg_employee_tenant/);
  });
  it("19 — a locked-down matricule counter + security-definer RPC (service_role only)", () => {
    expect(migration).toMatch(/function public\.next_employee_number\(p_tenant uuid\)/);
    expect(migration).toMatch(/security definer/);
    expect(migration).toMatch(/revoke execute on function public\.next_employee_number\(uuid\) from public/);
    expect(migration).toMatch(/grant execute on function public\.next_employee_number\(uuid\) to service_role/);
  });
  it("20 — adds hr:read and hr:manage to the permission catalog", () => {
    expect(migration).toContain("'hr:read'");
    expect(migration).toContain("'hr:manage'");
  });
  it("21 — creates HR_OFFICER by GUARDED backfill (clean-replay safe)", () => {
    expect(migration).toMatch(/insert into public\.role[\s\S]*?'HR_OFFICER'[\s\S]*?where exists \(select 1 from public\.organization where id = '00000000-0000-0000-0000-000000000001'\)/);
  });
  it("22 — self-management is forbidden by a CHECK", () => {
    expect(migration).toMatch(/manager_employee_id <> id/);
  });
});

// ============================================ grant matrix / SYSTEM_ADMIN exception (23-27) ====
describe("HR authorization — HR_OFFICER only, SYSTEM_ADMIN excluded (DEC-B25)", () => {
  const grantBlocks = (stripSql(seed).match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? []);

  it("23 — HR_OFFICER is the 25th tenant role, mapped to HUMAN_RESOURCES", () => {
    expect(TENANT_ROLE_KEYS).toHaveLength(25);
    expect(TENANT_ROLE_KEYS).toContain("HR_OFFICER");
    expect(roleCanonicalDepartment("HR_OFFICER")).toBe("HUMAN_RESOURCES");
  });
  it("24 — HR_OFFICER template holds hr:read + hr:manage and NOTHING elevated", () => {
    const perms = getTenantRoleTemplate("HR_OFFICER")?.permissions ?? [];
    expect(perms).toContain("hr:read");
    expect(perms).toContain("hr:manage");
    for (const forbidden of ["admin:users:manage", "admin:roles:manage", "finance:read", "process:read", "file:read"]) {
      expect(perms, forbidden).not.toContain(forbidden);
    }
  });
  it("25 — NO seed grant block gives hr:* to SYSTEM_ADMIN", () => {
    for (const b of grantBlocks) {
      if (/hr:(read|manage)/.test(b)) expect(/SYSTEM_ADMIN/.test(b), b.slice(0, 80)).toBe(false);
    }
  });
  it("26 — hr:* appears in the catalog exactly for the HR_OFFICER grant", () => {
    const hrGrant = grantBlocks.find((b) => /hr:(read|manage)/.test(b)) ?? "";
    expect(hrGrant).toMatch(/r\.code = 'HR_OFFICER'/);
  });
  it("27 — HR_OFFICER has a French label and a display-priority slot", () => {
    expect(roleLabel("HR_OFFICER")).toBe("Chargé RH");
    expect(ROLE_DISPLAY_PRIORITY).toContain("HR_OFFICER");
  });
});

// ============================================ navigation (28-30) ====
describe("navigation — « Ressources humaines » under MANAGEMENT", () => {
  it("28 — is a MANAGEMENT item at /departments/hr gated on hr:read", () => {
    const mgmt = navSections.find((s) => s.label === "Management")!;
    const hr = mgmt.items.find((i) => i.label === "Ressources humaines")!;
    expect(hr).toBeDefined();
    expect(hr.href).toBe("/departments/hr");
    expect(hr.permission).toBe("hr:read");
  });
  it("29 — is NOT a DÉPARTEMENTS entry", () => {
    const dep = navSections.find((s) => s.label === "Départements")!;
    expect(dep.items.some((i) => i.href === "/departments/hr")).toBe(false);
  });
  it("30 — the five permanent sections are unchanged", () => {
    expect(navSections.map((s) => s.label)).toEqual([
      "Pilotage", "Dossiers", "Départements", "Management", "Administration",
    ]);
  });
});

// ============================================ actions — structural guarantees (31-38) ====
describe("server actions — gated, tenant-scoped, grants nothing, revokes nothing", () => {
  const code = stripJs(actions);
  it("31 — every mutation runs behind the hr:manage guard", () => {
    expect(code).toMatch(/assertPermission\("hr:manage"\)/);
    // create/update/transition/link/unlink all call guard()
    expect((code.match(/const ctx = await guard\(\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it("32 — never writes public.user_role (linking grants nothing)", () => {
    expect(code).not.toMatch(/from\(["']user_role["']\)/);
    expect(code.toLowerCase()).not.toContain("user_role");
  });
  it("33 — termination NEVER bans/archives the account itself (prompt only)", () => {
    expect(code).not.toContain("setUserAuthBan");
    expect(code).not.toContain("banned_until");
    expect(code).not.toMatch(/archiveUser|setUserStatus/);
    expect(code).toMatch(/promptRevocation/);
  });
  it("34 — every employee read/update is tenant-scoped; the insert row is tenant-stamped", () => {
    // Every select/update on employee filters by tenant; the one insert carries
    // tenant_id in the row instead (the isolation boundary for the admin client).
    const selectUpdate = code.match(/\.from\("employee"\)\s*\.(select|update)/g) ?? [];
    const tenantFilters = code.match(/\.eq\("tenant_id", ctx\.tenantId\)/g) ?? [];
    expect(selectUpdate.length).toBeGreaterThan(0);
    expect(tenantFilters.length).toBeGreaterThanOrEqual(selectUpdate.length);
    expect(code).toContain("tenant_id: ctx.tenantId"); // insert row is tenant-stamped
  });
  it("35 — status change uses compare-and-set on the prior status", () => {
    expect(code).toMatch(/\.eq\("status", from\)/);
  });
  it("36 — audit payloads carry NO contact values (redaction)", () => {
    // The audit calls' `after`/`before` may reference safe fields only. Assert no
    // contact/email/phone VALUE fields are placed in an audit payload object.
    const auditCalls = code.match(/writeAudit\(\{[\s\S]*?\}\);/g) ?? [];
    expect(auditCalls.length).toBeGreaterThanOrEqual(5);
    for (const call of auditCalls) {
      for (const leak of ["professional_email", "personal_email", "professional_phone", "personal_phone", "emergency_contact"]) {
        expect(call, leak).not.toContain(leak);
      }
    }
  });
  it("37 — the account link verifies an ACTIVE same-tenant account", () => {
    expect(code).toMatch(/status !== "active"/);
    expect(code).toMatch(/account_not_eligible/);
    expect(code).toMatch(/account_already_linked/);
  });
  it("38 — readers are tenant-scoped (isolation boundary for the service-role client)", () => {
    expect(isTenantScopedTable("employee")).toBe(true);
    expect(isTenantScopedTable("employee_counter")).toBe(true);
    const r = stripJs(readMod);
    const accesses = r.match(/\.from\("employee"\)/g) ?? [];
    const scoped = r.match(/\.eq\("tenant_id", tenantId\)/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(accesses.length);
  });
});

// ============================================ pages + build-info (39-43) ====
describe("pages and pins", () => {
  it("39 — the registry page is gated on hr:read (notFound otherwise)", () => {
    expect(registryPage).toMatch(/hasPermission\(permissions, "hr:read"\)/);
    expect(registryPage).toMatch(/notFound\(\)/);
  });
  it("40 — the profile page is gated on hr:read and keys on the matricule, not the raw id", () => {
    expect(profilePage).toMatch(/hasPermission\(permissions, "hr:read"\)/);
    expect(profilePage).toContain("employee.employee_number");
    // the row id is only passed as an action prop — never rendered as visible text.
    expect(profilePage).not.toMatch(/>\s*\{employee\.id\}\s*</);
  });
  it("41 — « Nouvel employé » affordance requires hr:manage", () => {
    expect(registryPage).toMatch(/hasPermission\(permissions, "hr:manage"\)/);
  });
  it("42 — build-info pins the HR migration as newest + data-probeable via hr:read", () => {
    expect(LATEST_MIGRATION).toBe("20260724000002_hr_employee_registry");
    expect(MIGRATION_PROBE.permissionCode).toBe("hr:read");
  });
  it("43 — the RLS suite proves SYSTEM_ADMIN sees ZERO employee rows", () => {
    expect(rls).toMatch(/h2_system_admin_sees/);
    expect(rls).toMatch(/h2_sees<>0/);
    expect(migrationRaw).toContain("DEC-B25"); // the decision is cited at the source
  });
});

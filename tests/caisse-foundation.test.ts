/**
 * Phase 9.3A — Caisse & Trésorerie foundation.
 * ---------------------------------------------------------------------------
 * The role/permission/department contracts are tested directly against the
 * registries; the route/nav/migration guarantees structurally against source.
 * Full seed↔template parity is separately enforced by tests/role-templates.test.ts;
 * here we assert the Caisse-specific invariants: segregation of duties, correct
 * placement (workspace not department, label "Caisse" not "Caissière"), and
 * server-side gating on caisse:manage.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  TENANT_ROLE_TEMPLATES,
  TENANT_ROLE_KEYS,
  getTenantRoleTemplate,
  selectTenantRoleTemplates,
} from "@/lib/platform/role-templates";
import { roleCanonicalDepartment } from "@/lib/organization/departments";
import { roleLabel, ROLE_DISPLAY_PRIORITY, KNOWN_ROLE_CODES } from "@/lib/navigation/roles";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
/** Strip SQL/JS comments so assertions test STATEMENTS, not explanatory prose. */
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
const stripJs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const migration = read("../supabase/migrations/20260724000001_caisse_foundation.sql");
const seed = read("../supabase/seed.sql");
const buildNav = read("../lib/navigation/build.ts");
const baseNav = read("../lib/nav.ts");
const caisseRoute = read("../app/finance/caisse/page.tsx");
const financeDept = read("../app/departments/finance/page.tsx");

const FORBIDDEN_FOR_CASHIER = [
  "finance:validate", "finance:issue", "finance:void", "finance:delete", "finance:payment",
  "collections:manage", "admin_service:manage",
];

// ================================================= CASHIER role (tests 1-8) ====

describe("CASHIER role", () => {
  const cashier = () => getTenantRoleTemplate("CASHIER")!;

  it("1 — is a tenant role (25 total after HR-1 added HR_OFFICER)", () => {
    expect(TENANT_ROLE_KEYS).toHaveLength(25);
    expect(TENANT_ROLE_KEYS).toContain("CASHIER");
  });

  it("2 — carries the French label « Caissier / Caissière »", () => {
    expect(cashier().labelFr).toBe("Caissier / Caissière");
    expect(roleLabel("CASHIER")).toBe("Caissier / Caissière");
  });

  it("3 — maps to the FINANCE canonical department", () => {
    expect(roleCanonicalDepartment("CASHIER")).toBe("FINANCE");
  });

  it("4 — holds caisse:manage and finance:read (least privilege)", () => {
    expect(cashier().permissions).toContain("caisse:manage");
    expect(cashier().permissions).toContain("finance:read");
  });

  it("5 — holds process:read for Mon Travail visibility (read-only, no authority)", () => {
    expect(cashier().permissions).toContain("process:read");
  });

  it("6 — SEGREGATION: holds no finance authorization or collections/admin permission", () => {
    for (const p of FORBIDDEN_FOR_CASHIER) {
      expect(cashier().permissions, `CASHIER must not hold ${p}`).not.toContain(p);
    }
  });

  it("7 — grants nothing beyond profile + finance:read + caisse:manage + process:read", () => {
    expect([...cashier().permissions].sort()).toEqual(
      ["caisse:manage", "finance:read", "process:read", "profile:read:self", "profile:update:self"],
    );
  });

  it("8 — is provisioned to every tenant (no business-profile gate)", () => {
    expect(cashier().businessProfile).toBeUndefined();
    expect(selectTenantRoleTemplates({}).map((t) => t.key)).toContain("CASHIER");
    expect(cashier().requiredForEveryTenant).toBe(false);
  });
});

// ================================= caisse:manage permission (tests 9-13) ====

describe("caisse:manage permission", () => {
  it("9 — exists in the migration catalog with a French description", () => {
    expect(migration).toContain("'caisse:manage'");
    expect(migration).toContain("Gérer les opérations de caisse et de trésorerie");
  });

  it("10 — is mirrored in seed.sql", () => {
    expect(seed).toContain("'caisse:manage'");
    expect(seed).toContain("'CASHIER', 'Caissier / Caissière', 'Cashier'");
  });

  it("11 — is held by exactly CASHIER + the two supervisory roles, nobody else", () => {
    const holders = TENANT_ROLE_TEMPLATES.filter((t) => t.permissions.includes("caisse:manage")).map((t) => t.key);
    expect([...holders].sort()).toEqual(["CASHIER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]);
  });

  it("12 — is NOT granted to other finance roles (segregation)", () => {
    for (const r of ["FINANCE_OFFICER", "BILLING_OFFICER", "COLLECTIONS_OFFICER", "CUSTOMS_FINANCE_OFFICER", "ADMINISTRATIVE_OFFICER", "COURIER"]) {
      expect(getTenantRoleTemplate(r)!.permissions, `${r} must not hold caisse:manage`).not.toContain("caisse:manage");
    }
  });

  it("13 — is well-formed module:action", () => {
    expect("caisse:manage").toMatch(/^[a-z_]+:[a-z_]+$/);
  });
});

// ============================= role presentation parity (tests 14-15) ====

describe("role presentation", () => {
  it("14 — CASHIER is in the display-priority list (label↔priority parity)", () => {
    expect(ROLE_DISPLAY_PRIORITY).toContain("CASHIER");
    expect(KNOWN_ROLE_CODES).toContain("CASHIER");
    // every known code has a priority slot and vice versa
    expect([...KNOWN_ROLE_CODES].sort()).toEqual([...ROLE_DISPLAY_PRIORITY].sort());
  });

  it("15 — the employee title is a ROLE label only, never a nav/department label", () => {
    // Caissier/Caissière must not appear as a sidebar/department/workspace label.
    expect(baseNav).not.toMatch(/Caissi[eè]re?/);
    expect(buildNav).not.toMatch(/Caissi[eè]re?/);
  });
});

// ========================================= navigation placement (16-21) ====

describe("navigation placement — workspace not department", () => {
  it("16 — the permanent sidebar keeps five sections and its frozen department items", () => {
    const sectionKeys = [...baseNav.matchAll(/key:\s*"(pilotage|files|departments|management|administration)"/g)].map((m) => m[1]);
    expect(new Set(sectionKeys)).toEqual(new Set(["pilotage", "files", "departments", "management", "administration"]));
    // Départements still lists whole department modules — Caisse is NOT among them.
    expect(baseNav).not.toMatch(/href:\s*"\/finance\/caisse"/);
    expect(baseNav).not.toMatch(/label:\s*"Caisse"/);
  });

  it("17 — Finance is not renamed and Direction is untouched", () => {
    expect(baseNav).toContain('label: "Finance", href: "/departments/finance"');
    expect(baseNav).toContain('key: "direction"');
    expect(baseNav).toContain('href: "/departments/management"');
  });

  it("18 — the Finance department page links to /finance/caisse in a permission-gated workspace list", () => {
    expect(financeDept).toContain('href: "/finance/caisse"');
    expect(financeDept).toContain('"caisse:manage"');
    // Each finance workspace link is filtered by its own permission.
    expect(financeDept).toContain("hasPermission(permissions, l.permission)");
  });

  it("19 — Mon Travail surfaces Caisse gated on the caisse:manage PERMISSION (not role ===)", () => {
    const fn = buildNav.slice(buildNav.indexOf("export function workspacesFor"));
    expect(fn).toContain('if (can("caisse:manage"))');
    expect(fn).toContain('href: "/finance/caisse"');
    expect(fn).toContain('label: "Caisse"');
    expect(fn).not.toMatch(/roleCodes[^\n]*===[^\n]*CASHIER/);
  });

  it("20 — the Mon Travail Caisse label is the WORKSPACE name, never the title", () => {
    const fn = buildNav.slice(buildNav.indexOf('if (can("caisse:manage"))'), buildNav.indexOf('if (can("caisse:manage"))') + 400);
    expect(fn).toContain('label: "Caisse"');
    expect(fn).not.toMatch(/Caissi[eè]re?/);
  });

  it("21 — Caisse is NOT added to the canonical department registry", () => {
    const depts = read("../lib/organization/departments.ts");
    expect(depts).toContain('CanonicalDepartmentCode = "OPERATIONS" | "TRANSIT" | "FINANCE" | "HUMAN_RESOURCES"');
    expect(depts).not.toMatch(/code:\s*"CAISSE"/);
  });
});

// ============================================ route authorization (22-25) ====

describe("Caisse route (/finance/caisse) authorization + honesty", () => {
  it("22 — resolves the session normally and gates on caisse:manage server-side", () => {
    expect(caisseRoute).toContain("requireUser()");
    expect(caisseRoute).toContain("getEffectivePermissions(user.id)");
    expect(caisseRoute).toContain('hasPermission(permissions, "caisse:manage")');
    expect(caisseRoute).toContain("notFound()");
  });

  it("23 — finance:read alone is insufficient (only caisse:manage gates the route)", () => {
    // The route's only permission check is caisse:manage.
    const perms = [...caisseRoute.matchAll(/hasPermission\(permissions, "([a-z:]+)"\)/g)].map((m) => m[1]);
    expect(perms).toEqual(["caisse:manage"]);
  });

  it("24 — uses no service-role client and introduces no bypass", () => {
    expect(caisseRoute).not.toContain("getAdminSupabaseClient");
    expect(caisseRoute).not.toContain("service_role");
  });

  it("25 — describes multi-channel treasury and marks capabilities as future, no fake data", () => {
    expect(caisseRoute).toContain("Espèces");
    expect(caisseRoute).toContain("Chèques");
    expect(caisseRoute).toContain("Mobile Money");
    expect(caisseRoute).toContain("bancaires");
    expect(caisseRoute).toContain("à venir");
    // No fabricated figures in the RENDERED code (comments excluded): no displayed
    // balance/amount and no data-fetch of nonexistent treasury data.
    const rendered = stripJs(caisseRoute);
    expect(rendered).not.toMatch(/\bsolde\b|montant\s*:/i);
    expect(rendered).not.toMatch(/\d[\s ]*XOF/);
    expect(rendered).not.toContain("getAdminSupabaseClient");
    expect(rendered).not.toMatch(/getFinanceQueue|getReconciliation|\.from\(/);
  });
});

// ============================================ no treasury engine (26-27) ====

describe("no treasury business tables in this phase", () => {
  const sql = stripSql(migration);

  it("26 — the migration creates NO table at all (foundation is role/permission only)", () => {
    expect(sql).not.toMatch(/create\s+table/i);
    for (const t of ["treasury_", "cash_movement", "cash_session", "bank_account", "wallet", "check_register"]) {
      expect(sql.toLowerCase()).not.toContain(t);
    }
  });

  it("27 — the migration is additive: no destructive statement, all inserts idempotent", () => {
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\s+from\b|\balter\s+table\b|\bupdate\s+\w+\s+set\b/i);
    expect((migration.match(/on conflict/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

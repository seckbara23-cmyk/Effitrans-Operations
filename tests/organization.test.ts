/**
 * Phase 9.0A — canonical organization registry: the four real Effitrans
 * departments, the Transit-under-Operations hierarchy, and the role mapping.
 * ---------------------------------------------------------------------------
 * The registry is PURE organizational metadata (never authorization), so most
 * of this is direct pure-function testing; the preservation guarantees
 * (role codes, permission codes, production readability, RBAC unchanged) are
 * asserted structurally against the real seed/templates, per repo convention.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CANONICAL_DEPARTMENTS,
  TRANSIT_TEAMS,
  ROLE_CANONICAL_DEPARTMENT,
  roleCanonicalDepartment,
  departmentDisplayLabelFr,
  departmentLabelFr,
  isCanonicalDepartment,
  getCanonicalDepartment,
  CONTACT_DEPARTMENT_TO_CANONICAL,
  QUEUE_DEPARTMENT_TO_CANONICAL,
  resolveLegacyDepartmentLabel,
} from "@/lib/organization/departments";
import { TENANT_ROLE_KEYS } from "@/lib/platform/role-templates";
import { CONTACT_DEPARTMENTS } from "@/lib/portal/self-service";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const registrySource = read("../lib/organization/departments.ts");
const registryCode = code("../lib/organization/departments.ts");
const staffDirectory = code("../lib/messaging/staff-directory.ts");
const seed = read("../supabase/seed.sql");

// -------------------------------------------------- 1/2: the four departments ----

describe("1/2 — exactly four canonical departments, Transit under Operations", () => {
  it("exactly OPERATIONS, TRANSIT, FINANCE, HUMAN_RESOURCES — nothing else", () => {
    expect(CANONICAL_DEPARTMENTS.map((d) => d.code).sort()).toEqual(
      ["FINANCE", "HUMAN_RESOURCES", "OPERATIONS", "TRANSIT"],
    );
  });

  it("TRANSIT's organizational parent is OPERATIONS; no other department has a parent", () => {
    expect(getCanonicalDepartment("TRANSIT")!.parent).toBe("OPERATIONS");
    for (const d of CANONICAL_DEPARTMENTS) {
      if (d.code !== "TRANSIT") expect(d.parent, d.code).toBeNull();
    }
  });

  it("TRANSIT is independently selectable — a real department row, not an alias of Operations", () => {
    expect(isCanonicalDepartment("TRANSIT")).toBe(true);
    expect(departmentLabelFr("TRANSIT")).toBe("Transit");
  });

  it("French labels exist for all four", () => {
    expect(CANONICAL_DEPARTMENTS.map((d) => d.labelFr)).toEqual(
      ["Opérations", "Transit", "Finance", "Ressources humaines"],
    );
  });
});

// -------------------------------------------------- 3/4: Maritime and AIBD are teams ----

describe("3/4 — Maritime and AIBD are Transit TEAMS, never departments", () => {
  it("neither MARITIME nor AIBD is a canonical department", () => {
    expect(isCanonicalDepartment("MARITIME")).toBe(false);
    expect(isCanonicalDepartment("AIBD")).toBe(false);
  });

  it("both exist as teams under TRANSIT", () => {
    expect(TRANSIT_TEAMS.map((t) => t.code).sort()).toEqual(["AIBD", "MARITIME"]);
    for (const t of TRANSIT_TEAMS) expect(t.department).toBe("TRANSIT");
  });
});

// -------------------------------------------------- 5-9: role mapping ----

describe("5-9 — role-to-department mapping follows the confirmed business decisions", () => {
  it("5 — Documentation belongs to Operations (DOCUMENTATION_OFFICER)", () => {
    expect(roleCanonicalDepartment("DOCUMENTATION_OFFICER")).toBe("OPERATIONS");
  });

  it("6 — Transport coordination belongs to Transit (TRANSPORT_OFFICER)", () => {
    expect(roleCanonicalDepartment("TRANSPORT_OFFICER")).toBe("TRANSIT");
  });

  it("7 — the Déclarant en douane is Transit", () => {
    expect(roleCanonicalDepartment("CUSTOMS_DECLARANT")).toBe("TRANSIT");
  });

  it("Transit staff roles: Chef de Transit, field agent, pickup, driver", () => {
    for (const r of ["CHIEF_OF_TRANSIT", "CUSTOMS_FIELD_AGENT", "PICKUP_AGENT", "DRIVER"]) {
      expect(roleCanonicalDepartment(r), r).toBe("TRANSIT");
    }
  });

  it("Operations staff roles: Coordinateur, Superviseur, Account Manager", () => {
    for (const r of ["COORDINATOR", "OPS_SUPERVISOR", "ACCOUNT_MANAGER"]) {
      expect(roleCanonicalDepartment(r), r).toBe("OPERATIONS");
    }
  });

  it("8 — Finance roles remain mapped to Finance (incl. Facturation and Recouvrement)", () => {
    for (const r of ["FINANCE_OFFICER", "BILLING_OFFICER", "COLLECTIONS_OFFICER", "CUSTOMS_FINANCE_OFFICER"]) {
      expect(roleCanonicalDepartment(r), r).toBe("FINANCE");
    }
  });

  it("9 — HR does not process dossiers; HR_OFFICER is the (only) role mapped to HUMAN_RESOURCES", () => {
    expect(getCanonicalDepartment("HUMAN_RESOURCES")!.processesDossiers).toBe(false);
    // Phase HR-1 gave HUMAN_RESOURCES its first mapped role. It must be exactly HR_OFFICER —
    // no operational role silently rolls up into HR.
    const hrRoles = Object.entries(ROLE_CANONICAL_DEPARTMENT)
      .filter(([, dept]) => dept === "HUMAN_RESOURCES")
      .map(([role]) => role);
    expect(hrRoles).toEqual(["HR_OFFICER"]);
  });

  it("governance and external identities map to NO department, never a fabricated one", () => {
    for (const r of ["SYSTEM_ADMIN", "CEO", "COMPLIANCE_HSSE", "CLIENT_USER", "PARTNER_AGENT"]) {
      expect(roleCanonicalDepartment(r), r).toBeNull();
    }
    expect(roleCanonicalDepartment("NOT_A_ROLE")).toBeNull(); // unknown → null, no guess
  });
});

// -------------------------------------------------- 10/11: preservation ----

describe("10/11 — existing role and permission codes are preserved", () => {
  it("the mapping is TOTAL over exactly the seeded role catalog — no role removed, none invented", () => {
    expect(Object.keys(ROLE_CANONICAL_DEPARTMENT).sort()).toEqual([...TENANT_ROLE_KEYS].sort());
  });

  it("the registry introduces no permission strings and never touches authorization", () => {
    expect(registryCode).not.toMatch(/:read|:manage|:send|:create|:update|has_permission|assertPermission/);
    // Organizational metadata only — the module's own contract says so and enforces it.
    expect(registrySource).toContain("NEVER AUTHORIZATION");
  });

  it("existing permission codes still present in seed.sql (spot-check the ones near department semantics)", () => {
    for (const p of ["transport:manage", "customs:read", "messaging:read:customs", "process:read"]) {
      expect(seed, p).toContain(`'${p}'`);
    }
  });
});

// -------------------------------------------------- 12: legacy values resolve ----

describe("12 — legacy Transport & Logistique (and friends) resolve safely", () => {
  it("« Transport & Logistique » resolves to TRANSIT for display purposes", () => {
    expect(resolveLegacyDepartmentLabel("Transport & Logistique")).toBe("TRANSIT");
  });

  it("« Douane » and « Dédouanement » resolve to TRANSIT; « Documentation » to OPERATIONS", () => {
    expect(resolveLegacyDepartmentLabel("Douane")).toBe("TRANSIT");
    expect(resolveLegacyDepartmentLabel("Dédouanement")).toBe("TRANSIT");
    expect(resolveLegacyDepartmentLabel("Documentation")).toBe("OPERATIONS");
  });

  it("« Direction » / « Management » are governance, not departments — resolve to null", () => {
    expect(resolveLegacyDepartmentLabel("Direction")).toBeNull();
    expect(resolveLegacyDepartmentLabel("Management")).toBeNull();
    expect(resolveLegacyDepartmentLabel("Anything Unknown")).toBeNull();
  });
});

// -------------------------------------------------- 13/14: selection + production ----

describe("13/14 — department selection and production data safety", () => {
  it("13 — any department picker consumes exactly the four canonical entries (no fifth option exists to show)", () => {
    expect(CANONICAL_DEPARTMENTS).toHaveLength(4);
  });

  it("14 — no schema change: the registry is pure, imports no database client, adds no migration", () => {
    expect(registryCode).not.toMatch(/supabase|getAdmin|getServer|from\(|\.rpc\(|server-only/);
  });
});

// -------------------------------------------------- 15: staff search labels ----

describe("15 — staff search displays the corrected canonical department labels", () => {
  it("staff-directory derives departmentLabel from the canonical registry", () => {
    expect(staffDirectory).toContain('from "@/lib/organization/departments"');
    expect(staffDirectory).toContain("departmentDisplayLabelFr(primaryCode)");
  });

  it("a Déclarant now reads « Transit », a Chargé finance « Finance », an admin no department", () => {
    expect(departmentDisplayLabelFr("CUSTOMS_DECLARANT")).toBe("Transit");
    expect(departmentDisplayLabelFr("FINANCE_OFFICER")).toBe("Finance");
    expect(departmentDisplayLabelFr("DOCUMENTATION_OFFICER")).toBe("Opérations");
    expect(departmentDisplayLabelFr("SYSTEM_ADMIN")).toBeNull();
    expect(departmentDisplayLabelFr(null)).toBeNull();
  });
});

// -------------------------------------------------- 16: messaging routing ----

describe("16 — messaging/contact routing categories resolve into canonical departments", () => {
  it("every CONTACT_DEPARTMENTS routing code has a canonical resolution (routing vocabulary itself preserved)", () => {
    expect(Object.keys(CONTACT_DEPARTMENT_TO_CANONICAL).sort()).toEqual([...CONTACT_DEPARTMENTS].sort());
    expect(CONTACT_DEPARTMENT_TO_CANONICAL.customs).toBe("TRANSIT");
    expect(CONTACT_DEPARTMENT_TO_CANONICAL.transport).toBe("TRANSIT");
    expect(CONTACT_DEPARTMENT_TO_CANONICAL.documentation).toBe("OPERATIONS");
    expect(CONTACT_DEPARTMENT_TO_CANONICAL.finance).toBe("FINANCE");
  });

  it("the messaging DB routing vocabulary is untouched — the Phase 8.7 CHECK constraints keep their five codes", () => {
    const migration = read("../supabase/migrations/20260722000001_messaging_center.sql");
    expect(migration).toContain("check (department_code in ('documentation', 'customs', 'transport', 'finance', 'general'))");
  });
});

// -------------------------------------------------- queue rollup parity ----

describe("workflow-queue rollup — the 15 engine queue codes all resolve to a canonical department", () => {
  it("covers exactly the ProcessDepartment vocabulary from lib/process/types.ts", () => {
    const typesSource = read("../lib/process/types.ts");
    const union = typesSource.slice(typesSource.indexOf("export type ProcessDepartment"), typesSource.indexOf(";", typesSource.indexOf("export type ProcessDepartment")));
    const queueCodes = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(queueCodes.length).toBe(15);
    expect(Object.keys(QUEUE_DEPARTMENT_TO_CANONICAL).sort()).toEqual(queueCodes.sort());
  });

  it("customs queues roll up to TRANSIT except finance_customs (Guide étape 5: Enregistrement — Finance)", () => {
    expect(QUEUE_DEPARTMENT_TO_CANONICAL.customs_declaration).toBe("TRANSIT");
    expect(QUEUE_DEPARTMENT_TO_CANONICAL.customs_field).toBe("TRANSIT");
    expect(QUEUE_DEPARTMENT_TO_CANONICAL.finance_customs).toBe("FINANCE");
  });
});

// -------------------------------------------------- 17/18: no behavior change ----

describe("17/18 — no tenant-crossing, no RBAC change", () => {
  it("the registry performs no I/O at all — nothing to cross a tenant with", () => {
    expect(registryCode).not.toMatch(/await|async|fetch|Promise/);
  });

  it("role templates and their permissions are untouched by this phase (parity suite still guards them)", () => {
    // The registry only READS role codes; lib/platform/role-templates.ts remains the
    // authorization source and its own seed-parity test (tests/role-templates.test.ts)
    // continues to pin every permission set.
    expect(registryCode).not.toContain("role-templates");
  });
});

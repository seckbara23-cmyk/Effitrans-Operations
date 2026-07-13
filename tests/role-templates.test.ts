/**
 * Phase 4.0B-2 — tenant role templates: parity with seed.sql + invariants.
 *
 * The parity test RE-PARSES supabase/seed.sql and asserts each template's
 * permission set exactly equals what the Effitrans tenant is seeded with — the
 * anti-drift guarantee that provisioning (4.0C) will reproduce today's behaviour.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  TENANT_ROLE_TEMPLATES,
  TENANT_ROLE_KEYS,
  getTenantRoleTemplate,
  requiredTenantRoleTemplates,
  selectTenantRoleTemplates,
} from "@/lib/platform/role-templates";

const ALL_ROLES = [
  "SYSTEM_ADMIN", "CEO", "QUOTATION_MANAGER", "ACCOUNT_MANAGER", "COORDINATOR",
  "CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT", "DOCUMENTATION_OFFICER", "TRANSPORT_OFFICER",
  "WAREHOUSE_COORDINATOR", "FINANCE_OFFICER", "OPS_SUPERVISOR", "COMPLIANCE_HSSE",
  "CLIENT_USER", "PARTNER_AGENT", "DRIVER",
  // Phase 5.0B — the seven roles the official 26-step process requires.
  "BILLING_OFFICER", "CUSTOMS_FINANCE_OFFICER", "CUSTOMS_FIELD_AGENT", "PICKUP_AGENT",
  "ADMINISTRATIVE_OFFICER", "COURIER", "COLLECTIONS_OFFICER",
];
// module 'finance' codes, as seeded (visible in seed.sql explicit lists).
const FINANCE_CODES = ["finance:read", "finance:create", "finance:update", "finance:issue", "finance:payment", "finance:void"];

/** Reconstruct role -> sorted perm list from seed.sql's role_permission inserts. */
function parseSeed(): Record<string, string[]> {
  const seedPath = fileURLToPath(new URL("../supabase/seed.sql", import.meta.url));
  const text = readFileSync(seedPath, "utf8");
  const blocks = text.match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? [];
  const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const map: Record<string, Set<string>> = Object.fromEntries(ALL_ROLES.map((r) => [r, new Set<string>()]));

  for (const b of blocks) {
    let perms: string[] = [];
    if (/p\.module\s*=\s*'finance'/.test(b)) perms = FINANCE_CODES;
    else {
      const inM = b.match(/p\.code\s+in\s*\(([\s\S]*?)\)/);
      const eqM = b.match(/p\.code\s*=\s*'([^']+)'/);
      if (inM) perms = quoted(inM[1]);
      else if (eqM) perms = [eqM[1]];
    }
    const rIn = b.match(/r\.code\s+in\s*\(([\s\S]*?)\)/);
    const rEq = b.match(/r\.code\s*=\s*'([^']+)'/);
    const roles = rIn ? quoted(rIn[1]) : rEq ? [rEq[1]] : ALL_ROLES;
    for (const r of roles) for (const p of perms) map[r]?.add(p);
  }
  return Object.fromEntries(ALL_ROLES.map((r) => [r, [...map[r]].sort()]));
}

describe("tenant role templates — parity with seed.sql (no drift)", () => {
  const seeded = parseSeed();

  it("covers exactly the 23 seeded roles", () => {
    expect([...TENANT_ROLE_KEYS].sort()).toEqual([...ALL_ROLES].sort());
  });

  it.each(ALL_ROLES)("%s permissions match the seeded set exactly", (role) => {
    const tpl = getTenantRoleTemplate(role);
    expect(tpl, `template ${role} missing`).toBeDefined();
    expect([...tpl!.permissions].sort()).toEqual(seeded[role]);
  });
});

describe("tenant role template invariants", () => {
  it("SYSTEM_ADMIN is the only role required for every tenant", () => {
    expect(requiredTenantRoleTemplates().map((t) => t.key)).toEqual(["SYSTEM_ADMIN"]);
  });

  it("no template grants any platform:* permission", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      for (const p of t.permissions) expect(p.startsWith("platform:")).toBe(false);
    }
  });

  it("TENANT_ADMIN (SYSTEM_ADMIN) receives no platform permission and maps correctly", () => {
    const admin = getTenantRoleTemplate("SYSTEM_ADMIN")!;
    expect(admin.genericName).toBe("TENANT_ADMIN");
    expect(admin.permissions.some((p) => p.startsWith("platform:"))).toBe(false);
    expect(admin.permissions).toContain("admin:users:manage");
  });

  it("DRIVER stays narrowly scoped (tracking + own profile only)", () => {
    const driver = getTenantRoleTemplate("DRIVER")!;
    expect([...driver.permissions].sort()).toEqual([
      "profile:read:self", "profile:update:self", "tracking:read", "tracking:write",
    ]);
    expect(driver.permissions.some((p) => p.startsWith("file:") || p.startsWith("finance:") || p.startsWith("admin:"))).toBe(false);
  });

  it("every permission code is a well-formed module:action[:scope] token", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      for (const p of t.permissions) expect(p).toMatch(/^[a-z_]+:[a-z_]+(:[a-z_]+)?$/);
    }
  });
});

describe("selectTenantRoleTemplates — deterministic instantiation", () => {
  it("with no capabilities: includes required + general roles, excludes capability-gated ones", () => {
    const keys = selectTenantRoleTemplates({}).map((t) => t.key);
    expect(keys).toContain("SYSTEM_ADMIN");
    expect(keys).toContain("ACCOUNT_MANAGER");
    // capability-gated roles are excluded
    expect(keys).not.toContain("CUSTOMS_DECLARANT"); // customsBroker
    expect(keys).not.toContain("CHIEF_OF_TRANSIT"); // customsBroker
    expect(keys).not.toContain("TRANSPORT_OFFICER"); // roadTransport
    expect(keys).not.toContain("DRIVER"); // roadTransport
    expect(keys).not.toContain("WAREHOUSE_COORDINATOR"); // warehousing
  });

  it("enabling a capability adds exactly its gated roles", () => {
    const keys = selectTenantRoleTemplates({ roadTransport: true }).map((t) => t.key);
    expect(keys).toContain("TRANSPORT_OFFICER");
    expect(keys).toContain("DRIVER");
    expect(keys).not.toContain("CUSTOMS_DECLARANT");
  });

  it("is deterministic and stable in registry order", () => {
    const a = selectTenantRoleTemplates({ customsBroker: true, roadTransport: true }).map((t) => t.key);
    const b = selectTenantRoleTemplates({ customsBroker: true, roadTransport: true }).map((t) => t.key);
    expect(a).toEqual(b);
    // stable order == registry order filtered
    const registryOrder = TENANT_ROLE_TEMPLATES.map((t) => t.key).filter((k) => a.includes(k));
    expect(a).toEqual(registryOrder);
  });
});

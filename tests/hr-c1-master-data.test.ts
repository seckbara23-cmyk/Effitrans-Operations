/**
 * EFFITRANS-HR-C1 — master-data CRUD completion.
 * ---------------------------------------------------------------------------
 * HR-2 found the master data create-only. This phase adds the corrections —
 * update ×3, deactivate ×2 more, and dependency-aware unit deactivation — under
 * the same authority, audit contract and frozen no-deletion rule.
 *
 * The hierarchy safety splits across two boundaries, and the tests mirror that:
 *   * DATABASE — trg_hr_org_unit_parent fires on INSERT OR UPDATE: self-parent,
 *     cross-tenant parent and the strict kind order are re-checked on every
 *     re-parent. The strict order is also the cycle proof: every ancestor has a
 *     strictly lower rank, so a descendant can never be accepted as a parent.
 *     (Proven live in supabase/tests/hr_c1_master_data_test.sql.)
 *   * ACTION — the trigger never looks DOWN, so a kind change that would break
 *     the unit's own children is checked in updateOrgUnit before the write.
 *     The action is the boundary (the HR-A2 rule).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UNIT_KINDS } from "@/lib/hr/org-tree";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const ORG = "lib/hr/organization-actions.ts";
const STUDIO = "components/hr/configuration-studio.tsx";

function action(name: string): string {
  const s = code(ORG);
  const i = s.indexOf(`export async function ${name}`);
  expect(i, name).toBeGreaterThan(-1);
  const j = s.indexOf("export async function", i + 1);
  return s.slice(i, j === -1 ? undefined : j);
}

// ===========================================================================
describe("updateOrgUnit — hierarchy safety at both boundaries", () => {
  it("the child-compatibility check runs BEFORE the write", () => {
    // THE MUTATION TARGET. The DB trigger validates the changed row against its
    // parent only; retyping a Département carrying Sections into an Équipe
    // would strand every child. Remove this check and the tree can be corrupted
    // through a plain kind edit.
    const b = action("updateOrgUnit");
    const check = b.indexOf('.eq("parent_id", id)');
    const write = b.indexOf(".update(patch)");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(write);
    expect(b).toContain('"invalid_kind_children"');
    // Rank comparison uses THE canonical order, not a local copy.
    expect(b).toContain("UNIT_KINDS.indexOf");
    expect([...UNIT_KINDS]).toEqual(["BUSINESS_UNIT", "DEPARTMENT", "SECTION", "TEAM"]);
  });

  it("re-parenting relies on the SAME database trigger as creation", () => {
    // The trigger fires before insert OR update — verified in the migration.
    expect(read("supabase/migrations/20260801000001_hr_organization_foundation.sql"))
      .toMatch(/create trigger trg_hr_org_unit_parent before insert or update/);
    // …and the action maps every one of its refusals to a stable code.
    const b = action("updateOrgUnit");
    for (const frag of ["hiérarchie", "propre parent", "introuvable", "autre organisation"]) {
      expect(b, frag).toContain(frag);
    }
    expect(b).toContain('"invalid_parent"');
  });

  it("every field is optional, trimmed, and the row is loaded tenant-scoped first", () => {
    const b = action("updateOrgUnit");
    expect(b.indexOf('.eq("tenant_id", admin.tenantId)')).toBeLessThan(b.indexOf("const patch"));
    expect(b).toContain('"not_found"');
    expect(b).toContain('"name_required"');
    // A no-op patch writes nothing.
    expect(b).toContain("Object.keys(patch).length === 0");
  });

  it("the audit carries before AND after", () => {
    const b = action("updateOrgUnit");
    expect(b).toContain('action: "hr.org_unit_updated"');
    expect(b).toMatch(/before: \{[\s\S]{0,200}unit_kind: current\.unit_kind/);
    expect(b).toContain("after: patch");
  });
});

// ===========================================================================
describe("unit deactivation — safe, warned, or refused", () => {
  it("active children REFUSE; open assignments WARN unless acknowledged", () => {
    const b = action("setOrgUnitActive");
    // Both inspections run before the write, only on deactivation.
    expect(b).toContain("if (!active)");
    expect(b).toContain('"active_children"');
    expect(b).toContain('"unit_in_use"');
    expect(b).toContain("acknowledgeInUse");
    // Order: refusal (children) is decided before the warning (assignments).
    expect(b.indexOf('"active_children"')).toBeLessThan(b.indexOf('"unit_in_use"'));
    // Open assignments = current placements, the same definition HR-A2 uses.
    expect(b).toContain('.is("effective_to", null)');
  });

  it("an acknowledged deactivation records that it was acknowledged", () => {
    expect(action("setOrgUnitActive")).toContain("acknowledged_in_use");
  });

  it("reactivation stays unconditional — history is never a blocker", () => {
    const b = action("setOrgUnitActive");
    // The dependency block is inside `if (!active)`; activation has no gate.
    expect(b.split("if (!active)").length).toBe(2);
  });
});

// ===========================================================================
describe("positions and sites — corrections under the same contract", () => {
  it("update loads tenant-scoped, maps duplicates, audits before/after", () => {
    for (const [fn, dup] of [["updatePosition", "already_exists"], ["updateWorkLocation", "already_exists"]] as const) {
      const b = action(fn);
      expect(b, fn).toContain('assertPermission("hr:config:manage")');
      expect(b, fn).toContain('"not_found"');
      expect(b, fn).toContain(`"${dup}"`);
      expect(b, fn).toMatch(/before: \{/);
    }
  });

  it("deactivation exists for both, flag-only, audited", () => {
    for (const fn of ["setPositionActive", "setWorkLocationActive"]) {
      const b = action(fn);
      expect(b, fn).toContain("is_active: active");
      expect(b, fn).toContain("writeAudit");
      expect(b, fn).not.toMatch(/\.delete\(/);
    }
  });

  it("no new permission was created — hr:config:manage owns every correction", () => {
    const s = code(ORG);
    const perms = [...s.matchAll(/assertPermission\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(new Set(perms)).toEqual(new Set(["hr:config:manage", "hr:manage"]));
  });
});

// ===========================================================================
describe("the studio shows manageable records, not creation forms", () => {
  it("units render as Nom | Type | Parent | Statut | Actions", () => {
    const s = read(STUDIO);
    for (const h of ["Nom", "Type", "Parent", "Statut", "Actions"]) {
      expect(s, h).toContain(`>${h}</th>`);
    }
  });

  it("Modifier / Désactiver / Réactiver reach the real actions", () => {
    const s = code(STUDIO);
    for (const fn of ["updateOrgUnit", "updatePosition", "updateWorkLocation", "setPositionActive", "setWorkLocationActive"]) {
      expect(s, fn).toContain(`${fn}(`);
    }
    expect(read(STUDIO)).toContain("Modifier");
    expect(read(STUDIO)).toContain("Réactiver");
  });

  it("the unit_in_use warning has a distinct confirmation path", () => {
    const s = code(STUDIO);
    expect(s).toContain('"unit_in_use"');
    expect(s).toContain("acknowledgeInUse: true");
    expect(read(STUDIO)).toContain("Confirmer la désactivation");
    // …and the operator-facing sentence says placements are PRESERVED.
    expect(read(STUDIO)).toContain("Elles seront conservées");
  });

  it("every new error code has a French sentence", () => {
    const s = read(STUDIO);
    for (const codeName of ["invalid_kind_children", "active_children", "unit_in_use"]) {
      expect(s, codeName).toMatch(new RegExp(`${codeName}: "`));
    }
  });
});

// ===========================================================================
describe("scope held", () => {
  it("no migration — is_active already existed on both tables", () => {
    const migrations = require("node:fs")
      .readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f: string) => f.endsWith(".sql"));
    expect(migrations).toHaveLength(Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]));
    expect(migrations.some((f: string) => f.includes("hr_c1") || f.includes("hr-c1"))).toBe(false);
  });

  it("HR-B3 followed: the apply stage exists and honours the same boundaries", () => {
    const s = code(ORG);
    expect(s).toContain("export async function applyHrImport");
    expect(s).not.toMatch(/from\("employee"\)\s*\.insert/);
  });
});

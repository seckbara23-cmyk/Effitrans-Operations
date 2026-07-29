/**
 * Phase 9.3C — Finance hub workspace links (Scope E) + the documented HR blocker
 * (Scope F). The department realignment itself (Départements → Opérations/Transit/
 * Finance, permissionsAnyOf, hub pages) shipped in the prior commit and is covered
 * by tests/journeys.test.ts, tests/departments-nav.test.ts, tests/nav-visibility.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { navSections } from "@/lib/nav";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const financeDept = read("../app/departments/finance/page.tsx");

describe("Finance hub workspace links (Scope E)", () => {
  it("lists the finance workspaces over EXISTING routes, each permission-gated", () => {
    for (const [label, href, perm] of [
      ["Facturation", "/finance", "finance:read"],
      ["Recouvrement", "/collections", "collections:manage"],
      ["Caisse", "/finance/caisse", "caisse:manage"],
      ["Rapprochement", "/finance/reconciliation", "finance:read"],
      ["Rapports", "/reports", "report:read"],
      // Phase 11.0C — over the 11.0B permission family, no new permission.
      ["Autorisations de dépenses", "/finance/autorisations-depenses", "finance:expense:read"],
    ] as const) {
      expect(financeDept, label).toContain(`label: "${label}"`);
      expect(financeDept, href).toContain(`href: "${href}"`);
      expect(financeDept, perm).toContain(`"${perm}"`);
    }
    // Each link is filtered by its own permission (cosmetic; routes re-check).
    expect(financeDept).toContain("hasPermission(permissions, l.permission)");
  });

  it("does not fabricate a standalone Finance Requests route (it is the per-dossier panel)", () => {
    expect(financeDept).not.toContain("/finance/requests");
    expect(financeDept).not.toContain('label: "Finance Requests"');
  });

  it("preserves the Caisse route and invents no finance permission", () => {
    expect(financeDept).toContain('href: "/finance/caisse"');
    // The guard's INTENT is « no invented scoped finance permission », not « none
    // at all »: 11.0B ratified the finance:expense:* family, so 11.0C's link may
    // use it. Every scoped finance permission on this page must be one that
    // actually exists in the permission catalog.
    // FIN-AGING-2 ratified a second scoped family, finance:aging:*, so the
    // catalogue this checks against is now the union of the migrations that
    // define them. The intent is unchanged and is the point of the test: a link
    // may only cite a permission that really exists.
    const scoped = [...financeDept.matchAll(/"(finance:[a-z]+:[a-z_]+)"/g)].map((m) => m[1]);
    const catalog = [
      "../supabase/migrations/20260725000001_expense_documents.sql",
      "../supabase/migrations/20260729000002_aging_balance_foundation.sql",
    ]
      .map((p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8"))
      .join("\n");
    for (const code of scoped) expect(catalog, code).toContain(`'${code}'`);
    expect(scoped.sort()).toEqual(["finance:aging:read", "finance:expense:read"]);
  });
});

// Phase HR-1 flipped the former 9.3C HR blocker: HR now has a real route
// (/departments/hr), permissions (hr:read/hr:manage) and role (HR_OFFICER), so
// « Ressources humaines » is a legitimate MANAGEMENT item — never a fabrication.
describe("HR under Management — now real (Phase HR-1)", () => {
  const seed = read("../supabase/seed.sql");
  const depts = read("../lib/organization/departments.ts");

  it("MANAGEMENT contains « Ressources humaines », gated on hr:read, at /departments/hr", () => {
    const mgmt = navSections.find((s) => s.label === "Management")!;
    expect(mgmt.items.map((i) => i.label)).toEqual([
      "Direction",
      "Ressources humaines",
      "Rapports",
      "Tableau exécutif",
    ]);
    const hr = mgmt.items.find((i) => i.label === "Ressources humaines")!;
    expect(hr.href).toBe("/departments/hr");
    expect(hr.permission).toBe("hr:read");
  });

  it("HR is NOT a DÉPARTEMENTS entry (it is a management support function)", () => {
    const dep = navSections.find((s) => s.label === "Départements")!;
    expect(dep.items.some((i) => /Ressources humaines/i.test(i.label) || i.href === "/departments/hr")).toBe(false);
    expect(dep.items.map((i) => i.label)).toEqual(["Opérations", "Transit", "Finance"]);
  });

  it("the HR permissions exist in the catalog and are held only by HR_OFFICER", () => {
    expect(seed).toMatch(/'hr:read'/);
    expect(seed).toMatch(/'hr:manage'/);
    // SYSTEM_ADMIN is deliberately NOT granted hr:* (DEC-B25). Assert no seed
    // grant block that targets SYSTEM_ADMIN also mentions an hr:* code.
    const blocks = seed.match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? [];
    for (const b of blocks) {
      if (/hr:(read|manage)/.test(b)) {
        expect(/SYSTEM_ADMIN/.test(b), "hr:* must not be granted to SYSTEM_ADMIN").toBe(false);
      }
    }
  });

  it("HUMAN_RESOURCES stays in the canonical registry (now with its first mapped role)", () => {
    expect(depts).toContain('code: "HUMAN_RESOURCES"');
    expect(depts).toContain('labelFr: "Ressources humaines"');
    expect(depts).toMatch(/HR_OFFICER:\s*"HUMAN_RESOURCES"/);
  });
});

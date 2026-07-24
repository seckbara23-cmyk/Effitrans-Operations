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

  it("preserves the Caisse route and does not alter Finance permissions", () => {
    expect(financeDept).toContain('href: "/finance/caisse"');
    // No new finance permission introduced on this page.
    expect(financeDept).not.toMatch(/"finance:[a-z]+:[a-z]+"/); // no invented scoped finance perms
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

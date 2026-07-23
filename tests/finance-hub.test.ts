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

describe("HR under Management — documented BLOCKER, not fabricated (Scope F)", () => {
  const seed = read("../supabase/seed.sql");
  const depts = read("../lib/organization/departments.ts");

  it("MANAGEMENT has NO Ressources humaines item — no HR route/permission exists to back one", () => {
    const mgmt = navSections.find((s) => s.label === "Management")!;
    expect(mgmt.items.map((i) => i.label)).toEqual(["Direction", "Rapports", "Tableau exécutif"]);
    expect(mgmt.items.some((i) => /Ressources humaines/i.test(i.label))).toBe(false);
  });

  it("no HR/workforce permission exists in the catalog (so no honest gate could be applied)", () => {
    expect(seed).not.toMatch(/'hr:[a-z]/i);
    expect(seed).not.toMatch(/'workforce:[a-z]/i);
    expect(seed).not.toMatch(/'rh:[a-z]/i);
  });

  it("HUMAN_RESOURCES stays in the canonical registry, unchanged (metadata only)", () => {
    expect(depts).toContain('code: "HUMAN_RESOURCES"');
    expect(depts).toContain('labelFr: "Ressources humaines"');
  });
});

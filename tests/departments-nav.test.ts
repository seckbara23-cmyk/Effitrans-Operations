import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { navSections, allNavItems } from "@/lib/nav";
import { canSeeNav, canSeeNavItem, type NavSessionLike } from "@/lib/auth/nav-visibility";

/**
 * Read the CODE, not the prose about it. The doc comment on app/settings/page.tsx
 * explains that it USED to render ModulePage — a scanner that trips over its own
 * documentation is measuring the wrong thing.
 */
const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const hrefs = allNavItems.map((i) => i.href);
const base: NavSessionLike = { permissions: [], loading: false, configured: true };

describe("Phase 2.0 — department navigation", () => {
  it("mirrors the three canonical operational departments (Opérations, Transit, Finance)", () => {
    // Realignment: DÉPARTEMENTS now matches the canonical operational departments.
    // Opérations + Transit are aggregated hubs (permissionsAnyOf over their
    // workspaces); Finance keeps its single gate. Direction stays under MANAGEMENT.
    const dept = navSections.find((s) => s.label === "Départements")!;
    const byLabel = Object.fromEntries(dept.items.map((i) => [i.label, i]));
    expect(dept.items.map((i) => i.label)).toEqual(["Opérations", "Transit", "Finance"]);
    expect(byLabel["Opérations"].href).toBe("/departments/operations");
    expect(byLabel["Opérations"].permissionsAnyOf).toEqual(["file:read", "client:read", "document:read"]);
    expect(byLabel["Transit"].href).toBe("/departments/transit");
    expect(byLabel["Transit"].permissionsAnyOf).toEqual(["customs:read", "transport:read"]);
    expect(byLabel["Finance"].href).toBe("/departments/finance");
    expect(byLabel["Finance"].permission).toBe("finance:read");
  });

  it("no longer lists Douane / Documentation / Transport as TOP-LEVEL entries (now workspaces)", () => {
    const dept = navSections.find((s) => s.label === "Départements")!;
    const labels = dept.items.map((i) => i.label);
    for (const gone of ["Douane", "Dédouanement", "Documentation", "Transport & Logistique"]) {
      expect(labels).not.toContain(gone);
    }
    // Their ROUTES are UNCHANGED (linked from the hubs) — no URL break, no redirect.
    expect(() => read("../app/departments/customs/page.tsx")).not.toThrow();
    expect(() => read("../app/departments/transport/page.tsx")).not.toThrow();
    expect(() => read("../app/departments/documentation/page.tsx")).not.toThrow();
  });

  it("lists Direction, Ressources humaines, Rapports and Tableau exécutif under MANAGEMENT", () => {
    const mgmt = navSections.find((s) => s.label === "Management");
    expect(mgmt).toBeDefined();
    // Phase HR-1 — « Ressources humaines » (gated hr:read) sits between Direction and
    // Rapports. HR is a management support function, never a DÉPARTEMENTS entry.
    expect((mgmt?.items ?? []).map((i) => i.href)).toEqual([
      "/departments/management",
      "/departments/hr",
      "/reports",
      "/dashboard/executive",
    ]);
  });

  it("preserves the core direct routes in nav", () => {
    expect(hrefs).toEqual(
      expect.arrayContaining(["/dashboard", "/files", "/clients", "/communications", "/users", "/settings/audit"]),
    );
  });

  it("does NOT reintroduce any removed mock / prototype route", () => {
    // /reports is the real BI reporting center (Phase 3.0), not a mock route.
    //
    // /settings USED to be on this list, and rightly so: it rendered ModulePage, a
    // Phase-2 placeholder with no data and no CRUD. Phase 5.0E-3 needed "Paramètres" in
    // the sidebar, so rather than ship the stub it REPLACED /settings with a real hub
    // over the settings pages that exist. This test is why that was not optional.
    for (const mock of ["/customers", "/shipments", "/documents"]) {
      expect(hrefs).not.toContain(mock);
    }
    // ...and the proof that /settings is no longer a placeholder.
    const settings = read("../app/settings/page.tsx");
    expect(settings).not.toContain("ModulePage");
    expect(settings).toContain("requireUser");
    expect(settings).toContain('hasPermission(permissions, "admin:config:manage")');
  });

  it("gates the aggregated hubs by ANY-OF and Finance by its single permission", () => {
    const dept = navSections.find((s) => s.label === "Départements")!;
    const transit = dept.items.find((i) => i.key === "transit")!;
    const finance = dept.items.find((i) => i.key === "finance")!;
    const operations = dept.items.find((i) => i.key === "operations")!;

    // A customs agent (customs:read only) sees Transit via any-of, not Finance.
    const customsUser = { ...base, permissions: ["customs:read"] };
    expect(canSeeNavItem(transit, customsUser)).toBe(true);
    expect(canSeeNavItem(finance, customsUser)).toBe(false);
    expect(canSeeNavItem(operations, customsUser)).toBe(false);

    // A transport officer (transport:read only) ALSO sees Transit — the any-of point.
    expect(canSeeNavItem(transit, { ...base, permissions: ["transport:read"] })).toBe(true);

    // A finance officer sees Finance, not Transit/Opérations.
    const financeUser = { ...base, permissions: ["finance:read"] };
    expect(canSeeNavItem(finance, financeUser)).toBe(true);
    expect(canSeeNavItem(transit, financeUser)).toBe(false);

    // An account manager (file:read) sees Opérations via any-of.
    expect(canSeeNavItem(operations, { ...base, permissions: ["file:read"] })).toBe(true);

    // Single-permission canSeeNav still works for non-aggregated items (regression).
    expect(canSeeNav("finance:read", financeUser)).toBe(true);
    expect(canSeeNav("analytics:read", financeUser)).toBe(false);
  });
});

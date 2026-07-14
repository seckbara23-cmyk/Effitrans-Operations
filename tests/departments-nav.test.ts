import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { navSections, allNavItems } from "@/lib/nav";
import { canSeeNav, type NavSessionLike } from "@/lib/auth/nav-visibility";

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
  it("keeps DÉPARTEMENTS to the four business domains, each behind its permission", () => {
    // Phase 5.0E-3: Direction (/departments/management) LEFT this section. It is
    // management oversight, not a fifth business domain — it lives under MANAGEMENT now.
    // The route is unchanged; only where it is listed moved.
    const dept = navSections.find((s) => s.label === "Départements");
    expect(dept).toBeDefined();
    const byHref = Object.fromEntries((dept?.items ?? []).map((i) => [i.href, i.permission]));
    expect(byHref).toEqual({
      "/departments/documentation": "document:read",
      "/departments/customs": "customs:read",
      "/departments/transport": "transport:read",
      "/departments/finance": "finance:read",
    });
  });

  it("says Douane, not Dédouanement", () => {
    // The label the sidebar shipped with was "Dédouanement" — an activity, not a domain.
    const dept = navSections.find((s) => s.label === "Départements")!;
    const labels = dept.items.map((i) => i.label);
    expect(labels).toContain("Douane");
    expect(labels).not.toContain("Dédouanement");
  });

  it("lists Direction under MANAGEMENT, beside Rapports and Tableau exécutif", () => {
    const mgmt = navSections.find((s) => s.label === "Management");
    expect(mgmt).toBeDefined();
    expect((mgmt?.items ?? []).map((i) => i.href)).toEqual([
      "/departments/management",
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

  it("gates each department item by its permission (cosmetic filter)", () => {
    // A customs agent (customs:read) sees the customs workspace, not finance.
    const customsUser = { ...base, permissions: ["customs:read"] };
    expect(canSeeNav("customs:read", customsUser)).toBe(true);
    expect(canSeeNav("finance:read", customsUser)).toBe(false);
    // A finance officer (finance:read) sees the finance workspace, not management.
    const financeUser = { ...base, permissions: ["finance:read"] };
    expect(canSeeNav("finance:read", financeUser)).toBe(true);
    expect(canSeeNav("analytics:read", financeUser)).toBe(false);
    // Management workspace requires analytics:read.
    expect(canSeeNav("analytics:read", { ...base, permissions: ["analytics:read"] })).toBe(true);
  });
});

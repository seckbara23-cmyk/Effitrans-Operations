import { describe, it, expect } from "vitest";
import { navSections, allNavItems } from "@/lib/nav";
import { canSeeNav, type NavSessionLike } from "@/lib/auth/nav-visibility";

const hrefs = allNavItems.map((i) => i.href);
const base: NavSessionLike = { permissions: [], loading: false, configured: true };

describe("Phase 2.0 — department navigation", () => {
  it("adds a Départements section with the five workspace routes + permissions", () => {
    const dept = navSections.find((s) => s.title === "Départements");
    expect(dept).toBeDefined();
    const byHref = Object.fromEntries((dept?.items ?? []).map((i) => [i.href, i.permission]));
    expect(byHref).toEqual({
      "/departments/documentation": "document:read",
      "/departments/customs": "customs:read",
      "/departments/transport": "transport:read",
      "/departments/finance": "finance:read",
      "/departments/management": "analytics:read",
    });
  });

  it("preserves the core direct routes in nav", () => {
    expect(hrefs).toEqual(
      expect.arrayContaining(["/dashboard", "/files", "/clients", "/communications", "/users", "/settings/audit"]),
    );
  });

  it("does NOT reintroduce any removed mock / prototype route", () => {
    for (const mock of ["/customers", "/shipments", "/documents", "/reports", "/settings"]) {
      expect(hrefs).not.toContain(mock);
    }
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

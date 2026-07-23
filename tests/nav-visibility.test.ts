import { describe, it, expect } from "vitest";
import { canSeeNav, canSeeNavItem, type NavSessionLike } from "@/lib/auth/nav-visibility";

const base: NavSessionLike = { permissions: [], loading: false, configured: true };

describe("canSeeNav (cosmetic nav filtering)", () => {
  it("always shows items with no permission requirement", () => {
    expect(canSeeNav(undefined, base)).toBe(true);
    expect(canSeeNav(undefined, { ...base, permissions: [] })).toBe(true);
  });

  it("shows everything while unconfigured (mock experience)", () => {
    expect(canSeeNav("audit:read:all", { ...base, configured: false })).toBe(true);
  });

  it("shows everything while session is loading", () => {
    expect(canSeeNav("audit:read:all", { ...base, loading: true })).toBe(true);
  });

  it("hides items the configured, loaded user lacks", () => {
    expect(canSeeNav("audit:read:all", base)).toBe(false);
  });

  it("shows items the user holds", () => {
    expect(canSeeNav("audit:read:all", { ...base, permissions: ["audit:read:all"] })).toBe(true);
  });
});

describe("canSeeNavItem (single + any-of gating)", () => {
  const user = (perms: string[]) => ({ ...base, permissions: perms });

  it("falls back to the single permission when no any-of is set", () => {
    expect(canSeeNavItem({ permission: "finance:read" }, user(["finance:read"]))).toBe(true);
    expect(canSeeNavItem({ permission: "finance:read" }, user(["customs:read"]))).toBe(false);
    expect(canSeeNavItem({}, user([]))).toBe(true); // no gate = visible
  });

  it("ANY-OF: visible when the user holds any one of the listed permissions", () => {
    const transit = { permissionsAnyOf: ["customs:read", "transport:read"] };
    expect(canSeeNavItem(transit, user(["customs:read"]))).toBe(true);
    expect(canSeeNavItem(transit, user(["transport:read"]))).toBe(true);
    expect(canSeeNavItem(transit, user(["customs:read", "file:read"]))).toBe(true);
    expect(canSeeNavItem(transit, user(["finance:read"]))).toBe(false);
    expect(canSeeNavItem(transit, user([]))).toBe(false);
  });

  it("any-of takes precedence over a stray single permission", () => {
    const item = { permission: "finance:read", permissionsAnyOf: ["customs:read"] };
    expect(canSeeNavItem(item, user(["finance:read"]))).toBe(false); // any-of wins
    expect(canSeeNavItem(item, user(["customs:read"]))).toBe(true);
  });

  it("shows everything while unconfigured or loading (like canSeeNav)", () => {
    const transit = { permissionsAnyOf: ["customs:read"] };
    expect(canSeeNavItem(transit, { ...base, configured: false })).toBe(true);
    expect(canSeeNavItem(transit, { ...base, loading: true })).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { canSeeNav, type NavSessionLike } from "@/lib/auth/nav-visibility";

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

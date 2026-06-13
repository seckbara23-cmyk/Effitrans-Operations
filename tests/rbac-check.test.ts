import { describe, it, expect } from "vitest";
import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
} from "@/lib/rbac/check";

const perms = ["profile:read:self", "audit:read:all", "admin:users:manage"];

describe("rbac check helpers (deny-by-default)", () => {
  it("hasPermission: true when held, false otherwise", () => {
    expect(hasPermission(perms, "audit:read:all")).toBe(true);
    expect(hasPermission(perms, "admin:roles:manage")).toBe(false);
    expect(hasPermission([], "audit:read:all")).toBe(false);
  });

  it("hasAllPermissions: requires every code", () => {
    expect(hasAllPermissions(perms, ["audit:read:all", "admin:users:manage"])).toBe(true);
    expect(hasAllPermissions(perms, ["audit:read:all", "admin:roles:manage"])).toBe(false);
    expect(hasAllPermissions(perms, [])).toBe(true); // vacuously true
  });

  it("hasAnyPermission: requires at least one code", () => {
    expect(hasAnyPermission(perms, ["admin:roles:manage", "audit:read:all"])).toBe(true);
    expect(hasAnyPermission(perms, ["admin:roles:manage", "nope"])).toBe(false);
    expect(hasAnyPermission(perms, [])).toBe(false);
  });
});

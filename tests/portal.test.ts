import { describe, it, expect } from "vitest";
import { canAccessPortal, isPortalRole, isPortalStatus } from "@/lib/portal/access";

describe("portal access", () => {
  it("only ACTIVE portal users may access", () => {
    expect(canAccessPortal("ACTIVE")).toBe(true);
    expect(canAccessPortal("INVITED")).toBe(false);
    expect(canAccessPortal("DISABLED")).toBe(false);
    expect(canAccessPortal("")).toBe(false);
  });

  it("role guard", () => {
    expect(isPortalRole("CLIENT_ADMIN")).toBe(true);
    expect(isPortalRole("CLIENT_USER")).toBe(true);
    expect(isPortalRole("SYSTEM_ADMIN")).toBe(false);
  });

  it("status guard", () => {
    expect(isPortalStatus("INVITED")).toBe(true);
    expect(isPortalStatus("DISABLED")).toBe(true);
    expect(isPortalStatus("PENDING")).toBe(false);
  });
});

/**
 * Phase 5.0E — identity / workspace resolution: the highest-privilege workspace wins.
 *
 * Regression guard for the production bug: a SYSTEM_ADMIN created with EVERY role
 * (including DRIVER) was routed to /driver, because three call sites decided "driver"
 * from roles.includes("DRIVER") — first-match-wins. Membership is not identity; a narrow
 * mobile identity (driver/courier) is defined by the ABSENCE of any operational role.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { postLoginPath } from "@/lib/auth/session-class";
import {
  isDriverOnly,
  isCourierOnly,
  narrowStaffIdentity,
  OPERATIONAL_ROLES,
} from "@/lib/auth/staff-identity";
import { resolveLandingRoute } from "@/lib/navigation/landing";
import { buildNavigation } from "@/lib/navigation/build";
import type { NavigationContext } from "@/lib/navigation/types";
import { resolveProcessFlags } from "@/lib/process/flags";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
/** The CODE, without prose — a comment that names the old pattern to explain the fix is not the old pattern. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const EVERY_ROLE = [
  "SYSTEM_ADMIN", "OPS_SUPERVISOR", "COORDINATOR", "ACCOUNT_MANAGER", "QUOTATION_MANAGER",
  "CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT", "CUSTOMS_FINANCE_OFFICER", "CUSTOMS_FIELD_AGENT",
  "TRANSPORT_OFFICER", "PICKUP_AGENT", "BILLING_OFFICER", "FINANCE_OFFICER",
  "ADMINISTRATIVE_OFFICER", "COLLECTIONS_OFFICER", "COURIER", "DRIVER",
];

const FLAGS_ON = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
});

const ctx = (over: Partial<NavigationContext> = {}): NavigationContext => ({
  userId: "u1",
  tenantId: "t1",
  roleCodes: [],
  permissions: ["process:read", "analytics:read", "file:read"],
  identityType: "tenant",
  featureFlags: FLAGS_ON,
  ...over,
});

// -------------------------------------------------- the exact regression ----

describe("THE regression: DRIVER never overrides SYSTEM_ADMIN", () => {
  it("a SYSTEM_ADMIN created with every role (incl. DRIVER) lands on the admin workspace", () => {
    expect(postLoginPath("staff", EVERY_ROLE)).toBe("/dashboard");
    expect(postLoginPath("staff", ["SYSTEM_ADMIN", "DRIVER"])).toBe("/dashboard");
  });

  it("is NOT classified as a driver identity", () => {
    expect(isDriverOnly(EVERY_ROLE)).toBe(false);
    expect(narrowStaffIdentity(EVERY_ROLE)).toBeNull();
  });

  it("gets the FULL staff sidebar, not the empty driver shell", () => {
    // A tenant identity (the correct classification) yields real sections.
    const nav = buildNavigation(ctx({ roleCodes: EVERY_ROLE, identityType: "tenant" }));
    expect(nav.sections.length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------- the priority rule ----

describe("the highest-privilege workspace wins", () => {
  it("driver-only → /driver; driver + ANY operational role → staff", () => {
    expect(postLoginPath("staff", ["DRIVER"])).toBe("/driver");
    for (const staffRole of OPERATIONAL_ROLES) {
      expect(postLoginPath("staff", ["DRIVER", staffRole]), staffRole).toBe("/dashboard");
    }
  });

  it("isDriverOnly requires DRIVER AND no operational role", () => {
    expect(isDriverOnly(["DRIVER"])).toBe(true);
    expect(isDriverOnly(["DRIVER", "COURIER"])).toBe(true); // both narrow → still driver
    expect(isDriverOnly(["SYSTEM_ADMIN", "DRIVER"])).toBe(false);
    expect(isDriverOnly(["ACCOUNT_MANAGER", "DRIVER"])).toBe(false);
    expect(isDriverOnly(["SYSTEM_ADMIN"])).toBe(false); // no driver role at all
  });

  it("narrowStaffIdentity: driver wins over courier; either loses to staff", () => {
    expect(narrowStaffIdentity(["DRIVER"])).toBe("driver");
    expect(narrowStaffIdentity(["COURIER"])).toBe("courier");
    expect(narrowStaffIdentity(["DRIVER", "COURIER"])).toBe("driver");
    expect(narrowStaffIdentity(["SYSTEM_ADMIN", "DRIVER", "COURIER"])).toBeNull();
    expect(narrowStaffIdentity(["BILLING_OFFICER"])).toBeNull();
  });
});

// -------------------------------------------------- the five brief cases ----

describe("workspace routing by role set", () => {
  it("SYSTEM_ADMIN always lands in the admin workspace", () => {
    expect(postLoginPath("staff", ["SYSTEM_ADMIN"])).toBe("/dashboard");
    expect(resolveLandingRoute(ctx({ roleCodes: ["SYSTEM_ADMIN"] }))).toBe("/dashboard");
  });

  it("a driver-only user lands in /driver", () => {
    expect(postLoginPath("staff", ["DRIVER"])).toBe("/driver");
    // ...and the navigation resolver gives a driver identity no staff sidebar.
    expect(buildNavigation(ctx({ roleCodes: ["DRIVER"], identityType: "driver" })).sections).toEqual([]);
  });

  it("a multi-role user receives the highest-priority workspace (oversight → dashboard)", () => {
    expect(resolveLandingRoute(ctx({ roleCodes: ["COORDINATOR", "CUSTOMS_DECLARANT", "DRIVER"] }))).toBe("/dashboard");
  });

  it("tenant staff never route to a platform surface", () => {
    expect(postLoginPath("staff", EVERY_ROLE)).not.toMatch(/^\/platform/);
    const hrefs = buildNavigation(ctx({ roleCodes: ["SYSTEM_ADMIN"] })).sections.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs.some((h) => h.startsWith("/platform"))).toBe(false);
  });

  it("a pure platform admin lands on /platform; a staff+platform user lands on staff home", () => {
    expect(postLoginPath("none", [], true)).toBe("/platform");
    expect(postLoginPath("staff", ["SYSTEM_ADMIN"], true)).toBe("/dashboard"); // staff wins
    // A portal user never reaches an operational surface.
    expect(postLoginPath("portal", ["anything"])).toBe("/portal");
  });
});

// -------------------------------------------------- structural: one source ----

describe("all three call sites use isDriverOnly, not raw membership", () => {
  it("the login destination keys on isDriverOnly", () => {
    const src = code("../lib/auth/session-class.ts");
    expect(src).toContain("isDriverOnly(roles)");
    expect(src).not.toContain('roles.includes("DRIVER")');
  });

  it("the route guard keys on isDriverOnly", () => {
    const src = code("../lib/auth/require-user.ts");
    expect(src).toContain("isDriverOnly(user.roles)");
    expect(src).not.toContain('user.roles.includes("DRIVER")');
  });

  it("the navigation identity keys on narrowStaffIdentity", () => {
    const src = code("../lib/navigation/server.ts");
    expect(src).toContain("narrowStaffIdentity(user.roles)");
    expect(src).not.toContain('user.roles.includes("DRIVER")');
  });

  it("the rule lives in ONE pure source of truth", () => {
    const shared = read("../lib/auth/staff-identity.ts");
    expect(shared).toContain("export function isDriverOnly");
    expect(shared).toContain("export function isCourierOnly");
    // landing.ts re-exports it rather than keeping a second copy.
    const landing = read("../lib/navigation/landing.ts");
    expect(landing).toContain('export { isCourierOnly, isDriverOnly } from "@/lib/auth/staff-identity"');
    expect(landing).not.toContain("!OPERATIONAL_ROLES.some"); // the old local copy is gone
  });

  it("isCourierOnly still behaves for its existing callers (no regression)", () => {
    expect(isCourierOnly(["COURIER"])).toBe(true);
    expect(isCourierOnly(["COURIER", "OPS_SUPERVISOR"])).toBe(false);
  });
});

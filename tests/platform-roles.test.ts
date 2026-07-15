/**
 * Phase 4.0B-1 — platform role/permission map + the platform↔tenant boundary.
 */
import { describe, it, expect } from "vitest";
import {
  PLATFORM_ROLES,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  platformPermissionsFor,
  hasPlatformPermission,
  isPlatformRole,
  isPlatformPermission,
} from "@/lib/platform/roles";

// A representative set of TENANT permission codes that must NEVER be usable for
// platform authorization (kept in sync only enough to prove the boundary).
const TENANT_PERMISSIONS = [
  "admin:users:manage",
  "admin:roles:manage",
  "admin:config:manage",
  "file:read",
  "file:read:all",
  "finance:read",
  "customs:read",
  "transport:read",
  "document:read",
  "analytics:read",
  "audit:read:all",
];

describe("platform roles", () => {
  it("defines exactly the four platform roles", () => {
    expect([...PLATFORM_ROLES]).toEqual([
      "PLATFORM_SUPER_ADMIN",
      "PLATFORM_SUPPORT",
      "PLATFORM_BILLING",
      "PLATFORM_READ_ONLY",
    ]);
  });

  it("every platform permission is in the platform:* namespace", () => {
    for (const p of PLATFORM_PERMISSIONS) expect(p.startsWith("platform:")).toBe(true);
  });

  it("SUPER_ADMIN holds every platform permission", () => {
    expect([...platformPermissionsFor("PLATFORM_SUPER_ADMIN")].sort()).toEqual([...PLATFORM_PERMISSIONS].sort());
  });

  it("SUPPORT and BILLING have NO mutation/operational permissions", () => {
    for (const role of ["PLATFORM_SUPPORT", "PLATFORM_BILLING"] as const) {
      const perms = platformPermissionsFor(role);
      expect(perms).not.toContain("platform:companies:create");
      expect(perms).not.toContain("platform:companies:update");
      expect(perms).not.toContain("platform:status:update");
      expect(perms).not.toContain("platform:settings:manage");
    }
  });

  it("READ_ONLY is strictly read-only", () => {
    for (const p of platformPermissionsFor("PLATFORM_READ_ONLY")) {
      expect(p.endsWith(":read")).toBe(true);
    }
  });

  it("snapshot of the role→permission map (guards against drift)", () => {
    const snapshot = Object.fromEntries(
      PLATFORM_ROLES.map((r) => [r, [...PLATFORM_ROLE_PERMISSIONS[r]].sort()]),
    );
    expect(snapshot).toEqual({
      PLATFORM_SUPER_ADMIN: [
        "platform:audit:read",
        "platform:companies:create",
        "platform:companies:read",
        "platform:companies:update",
        // Phase 6.0F — read-only Platform Copilot awareness.
        "platform:copilot:read",
        "platform:plans:read",
        // Phase 5.0E-2A — process rollout. SUPER_ADMIN only, deliberately: enabling
        // the workflow for a live freight forwarder is not a help-desk action.
        "platform:rollout:manage",
        "platform:settings:manage",
        "platform:status:update",
      ],
      PLATFORM_SUPPORT: ["platform:audit:read", "platform:companies:read", "platform:copilot:read", "platform:plans:read"],
      PLATFORM_BILLING: ["platform:companies:read", "platform:plans:read"],
      PLATFORM_READ_ONLY: ["platform:audit:read", "platform:companies:read", "platform:copilot:read", "platform:plans:read"],
    });
  });

  it("hasPlatformPermission reflects the map", () => {
    expect(hasPlatformPermission("PLATFORM_SUPER_ADMIN", "platform:companies:create")).toBe(true);
    expect(hasPlatformPermission("PLATFORM_READ_ONLY", "platform:companies:create")).toBe(false);
  });
});

describe("platform ↔ tenant boundary", () => {
  it("no tenant permission is a platform permission (and vice versa)", () => {
    for (const t of TENANT_PERMISSIONS) {
      expect(isPlatformPermission(t)).toBe(false);
      expect((PLATFORM_PERMISSIONS as readonly string[]).includes(t)).toBe(false);
    }
    for (const p of PLATFORM_PERMISSIONS) {
      expect(TENANT_PERMISSIONS.includes(p)).toBe(false);
    }
  });

  it("tenant role codes are not platform roles", () => {
    for (const code of ["SYSTEM_ADMIN", "OPS_SUPERVISOR", "CEO", "DRIVER", "CLIENT_USER"]) {
      expect(isPlatformRole(code)).toBe(false);
    }
  });
});

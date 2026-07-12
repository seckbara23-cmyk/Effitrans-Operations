/**
 * Platform roles & permissions (Phase 4.0B-1). PURE — no I/O, unit-testable.
 * ---------------------------------------------------------------------------
 * Platform administration is a small, operator-controlled surface, DISTINCT from
 * tenant RBAC. Platform permissions live in their OWN namespace (`platform:*`)
 * and are resolved from this fixed role→permission map — NOT from the tenant
 * `permission` / `role_permission` tables.
 *
 * Hard boundary (enforced by tests):
 *   - A tenant permission (`admin:users:manage`, `file:read`, `finance:read`, …)
 *     is NEVER valid for platform authorization.
 *   - A platform permission is NEVER valid for tenant authorization.
 *   - No platform role grants access to tenant OPERATIONAL data (there is simply
 *     no such permission in this namespace).
 */

export const PLATFORM_ROLES = [
  "PLATFORM_SUPER_ADMIN",
  "PLATFORM_SUPPORT",
  "PLATFORM_BILLING",
  "PLATFORM_READ_ONLY",
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_PERMISSIONS = [
  "platform:companies:read",
  "platform:companies:create",
  "platform:companies:update",
  "platform:status:update",
  "platform:plans:read",
  "platform:audit:read",
  "platform:settings:manage",
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/**
 * Role → permission sets.
 *  - SUPER_ADMIN : full platform control (metadata + tenants + platform config).
 *  - SUPPORT     : tenant metadata + support health (read companies/plans/audit).
 *                  NO tenant operational access and NO metadata mutations.
 *  - BILLING     : future subscription/account metadata (read companies/plans).
 *                  NO tenant operational access.
 *  - READ_ONLY   : read-only platform metadata.
 */
export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  PLATFORM_SUPER_ADMIN: [...PLATFORM_PERMISSIONS],
  PLATFORM_SUPPORT: ["platform:companies:read", "platform:plans:read", "platform:audit:read"],
  PLATFORM_BILLING: ["platform:companies:read", "platform:plans:read"],
  PLATFORM_READ_ONLY: ["platform:companies:read", "platform:plans:read", "platform:audit:read"],
};

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isPlatformPermission(value: string): value is PlatformPermission {
  return (PLATFORM_PERMISSIONS as readonly string[]).includes(value);
}

export function platformPermissionsFor(role: PlatformRole): readonly PlatformPermission[] {
  return PLATFORM_ROLE_PERMISSIONS[role] ?? [];
}

export function hasPlatformPermission(role: PlatformRole, code: PlatformPermission): boolean {
  return platformPermissionsFor(role).includes(code);
}

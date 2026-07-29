/**
 * User-administration capabilities. PURE constants — safe for client import.
 * ---------------------------------------------------------------------------
 * The single `admin:users:manage` umbrella could not distinguish "may read the
 * staff directory" from "may create and archive users", so every capability
 * travelled together and only SYSTEM_ADMIN could hold any of it. Worse, the
 * most sensitive act in the module — generating a temporary password, which
 * invalidates a live credential — rode on the same token as listing users.
 *
 * Each capability now names its own permission. Granted (2026-07-29) to
 * SYSTEM_ADMIN only; the point is that the vocabulary now EXISTS, so widening
 * later is a grant rather than a redesign.
 *
 * ===========================================================================
 * THE UMBRELLA IS A FALLBACK, NOT A SYNONYM
 * ===========================================================================
 * `admin:users:manage` is deprecated but still accepted, because migrations in
 * this project are applied by an operator SEPARATELY from the deploy. Between
 * "code shipped" and "migration applied", a tenant holds only the umbrella; if
 * the actions demanded the granular codes, the tenant's administrator would be
 * locked out of user administration — including the very screen used to fix it.
 *
 * So every gate reads: granular OR umbrella. It is removed in a later change,
 * once every tenant holds the granular set. Note the asymmetry — the umbrella
 * is never ADDED to a new role, only honoured where it already exists.
 */

export const USER_ADMIN_PERMISSIONS = {
  read: "admin:users:read",
  create: "admin:users:create",
  update: "admin:users:update",
  disable: "admin:users:disable",
  resetPassword: "admin:users:reset_password",
  tempPassword: "admin:users:temp_password",
  unlock: "admin:users:unlock",
} as const;

export type UserAdminCapability = keyof typeof USER_ADMIN_PERMISSIONS;

/**
 * DEPRECATED. Still granted, still honoured, never granted to anything new.
 * Retire it only when every tenant holds the granular set above.
 */
export const DEPRECATED_USER_ADMIN_UMBRELLA = "admin:users:manage";

/** The codes accepted for a capability, granular first (it names the error). */
export function userAdminCodes(capability: UserAdminCapability): readonly string[] {
  return [USER_ADMIN_PERMISSIONS[capability], DEPRECATED_USER_ADMIN_UMBRELLA];
}

/** Client-side mirror of the gate, for hiding controls the server would refuse. */
export function canUserAdmin(permissions: string[], capability: UserAdminCapability): boolean {
  return userAdminCodes(capability).some((c) => permissions.includes(c));
}

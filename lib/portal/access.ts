/**
 * Portal access predicates (Phase 1.12A) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Tiny, unit-tested rules for portal identity. The hard boundary is RLS; these
 * govern the app-level gating (only ACTIVE client_users may use the portal).
 */
export const PORTAL_STATUSES = ["INVITED", "ACTIVE", "DISABLED"] as const;
export const PORTAL_ROLES = ["CLIENT_ADMIN", "CLIENT_USER"] as const;

export type PortalUserStatus = (typeof PORTAL_STATUSES)[number];
export type PortalRole = (typeof PORTAL_ROLES)[number];

/** Only ACTIVE portal users may access the portal (INVITED/DISABLED cannot). */
export function canAccessPortal(status: string): boolean {
  return status === "ACTIVE";
}

/**
 * Phase 3.2B — a DISABLED portal user cannot be issued a temporary password
 * (they could not use it anyway); reactivate first. Any other status is allowed.
 */
export function canResetPortalPassword(status: string): boolean {
  return status !== "DISABLED";
}

export function isPortalStatus(v: string): v is PortalUserStatus {
  return (PORTAL_STATUSES as readonly string[]).includes(v);
}

export function isPortalRole(v: string): v is PortalRole {
  return (PORTAL_ROLES as readonly string[]).includes(v);
}

/**
 * Foundation audit action codes (AUD-2).
 * ---------------------------------------------------------------------------
 * A small, typed catalog of the audit actions used by the FOUNDATION (auth,
 * RBAC, admin governance). Business-domain action codes arrive with their
 * modules. Convention: "<entity>.<change>"; "system.*" = unattributed system
 * events; "*.override" = governance overrides (require an overrideReason).
 */
export const AuditActions = {
  USER_CREATED: "user.created",
  USER_ACTIVATED: "user.activated",
  USER_DEACTIVATED: "user.deactivated",
  USER_ROLE_ASSIGNED: "user.role.assigned",
  USER_ROLE_REVOKED: "user.role.revoked",
  ADMIN_OVERRIDE_ACCESS: "admin.override.access", // isOverride: true
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  SYSTEM_SEED: "system.seed",
} as const;

export type AuditActionCode = (typeof AuditActions)[keyof typeof AuditActions];

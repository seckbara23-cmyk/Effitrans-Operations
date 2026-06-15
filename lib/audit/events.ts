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
  // Phase 1.1 — Client Management
  CLIENT_CREATED: "client.created",
  CLIENT_UPDATED: "client.updated",
  CLIENT_ARCHIVED: "client.archived",
  CLIENT_RESTORED: "client.restored",
  // Phase 1.2 — Operational File + Shipment
  FILE_CREATED: "file.created",
  FILE_UPDATED: "file.updated",
  FILE_TRANSITION: "file.transition",
  FILE_ARCHIVED: "file.archived",
  // Phase 1.3 — Tasks
  TASK_CREATED: "task.created",
  TASK_UPDATED: "task.updated",
  TASK_STATUS_CHANGED: "task.status_changed",
  TASK_ASSIGNED: "task.assigned",
  TASK_COMPLETED: "task.completed",
  TASK_CANCELLED: "task.cancelled",
  // Phase 1.8 — Documents
  DOCUMENT_UPLOADED: "document.uploaded",
  DOCUMENT_UPDATED: "document.updated",
  DOCUMENT_APPROVED: "document.approved",
  DOCUMENT_REJECTED: "document.rejected",
  DOCUMENT_EXPIRED: "document.expired", // reserved — set by the deferred scheduler
  DOCUMENT_DELETED: "document.deleted",
  // Phase 1.9 — Customs
  CUSTOMS_CREATED: "customs.created",
  CUSTOMS_UPDATED: "customs.updated",
  CUSTOMS_STATUS_CHANGED: "customs.status_changed",
  CUSTOMS_DECLARED: "customs.declared",
  CUSTOMS_RELEASED: "customs.released",
  CUSTOMS_BLOCKED: "customs.blocked",
  CUSTOMS_DELETED: "customs.deleted",
} as const;

export type AuditActionCode = (typeof AuditActions)[keyof typeof AuditActions];

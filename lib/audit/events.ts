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
  // Phase 1.10 — Transport
  TRANSPORT_CREATED: "transport.created",
  TRANSPORT_UPDATED: "transport.updated",
  TRANSPORT_ASSIGNED: "transport.assigned",
  TRANSPORT_STATUS_CHANGED: "transport.status_changed",
  TRANSPORT_PICKED_UP: "transport.picked_up",
  TRANSPORT_DELIVERED: "transport.delivered",
  TRANSPORT_POD_RECEIVED: "transport.pod_received",
  TRANSPORT_CANCELLED: "transport.cancelled",
  TRANSPORT_DELETED: "transport.deleted",
  // Phase 1.11 — Finance
  CHARGE_CREATED: "charge.created",
  CHARGE_UPDATED: "charge.updated",
  CHARGE_DELETED: "charge.deleted",
  INVOICE_CREATED: "invoice.created",
  INVOICE_UPDATED: "invoice.updated",
  INVOICE_ISSUED: "invoice.issued",
  INVOICE_VOIDED: "invoice.voided",
  INVOICE_DELETED: "invoice.deleted",
  PAYMENT_RECORDED: "payment.recorded",
  PAYMENT_REVERSED: "payment.reversed",
  // Phase 1.15A — Payment verification / reconciliation
  PAYMENT_VERIFIED: "payment.verified",
  PAYMENT_REJECTED: "payment.rejected",
  // Phase 1.15B — Payment provider integration (intents + webhooks)
  PAYMENT_INTENT_CREATED: "payment_intent.created", // staff/portal-attributed
  PAYMENT_INTENT_CANCELLED: "payment_intent.cancelled", // staff/portal-attributed
  PAYMENT_INTENT_SUCCEEDED: "payment_intent.succeeded", // machine (webhook)
  PAYMENT_INTENT_FAILED: "payment_intent.failed", // machine (webhook)
  PAYMENT_INTENT_EXPIRED: "payment_intent.expired", // machine (TTL sweep)
  PROVIDER_WEBHOOK_RECEIVED: "provider.webhook.received", // machine
  PROVIDER_WEBHOOK_REPLAYED: "provider.webhook.replayed", // machine (dup/replay/reject)
  PAYMENT_AUTO_RECORDED: "payment.auto_recorded", // machine (webhook success)
  // Phase 1.12 — Customer Portal
  PORTAL_USER_INVITED: "portal.user.invited",
  PORTAL_USER_ACTIVATED: "portal.user.activated",
  PORTAL_LOGIN: "portal.login",
  PORTAL_DOCUMENT_DOWNLOADED: "portal.document.downloaded",
  PORTAL_INVOICE_VIEWED: "portal.invoice.viewed",
  // Phase 1.14 — Communications Hub
  COMMUNICATION_QUEUED: "communication.queued",
  COMMUNICATION_SENT: "communication.sent",
  COMMUNICATION_FAILED: "communication.failed",
  COMMUNICATION_CANCELLED: "communication.cancelled",
} as const;

export type AuditActionCode = (typeof AuditActions)[keyof typeof AuditActions];

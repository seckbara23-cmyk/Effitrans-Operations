/**
 * Pure validation for audit events (AUD-2). No imports — unit-testable.
 * ---------------------------------------------------------------------------
 * Extracted from lib/audit/log.ts so the rules can be tested without importing
 * the server-only write path. Behaviour is unchanged.
 *
 * Rules:
 *  - action is required (non-empty)
 *  - non-"system." actions REQUIRE an actorId OR a clientUserId (fail closed)
 *  - override actions (isOverride) REQUIRE an overrideReason
 *  - entityId, when present, must be a UUID (P1.6A)
 */
export type AuditEventInput = {
  action: string;
  actorId?: string | null;
  /** portal (client_user) actor — an alternative to actorId for portal.* events */
  clientUserId?: string | null;
  /** platform (platform_admin) actor — attribution for platform.* events */
  platformActorId?: string | null;
  /** The audited row's id. `audit_log.entity_id` is a UUID column. */
  entityId?: string | null;
  isOverride?: boolean;
  overrideReason?: string | null;
};

/**
 * MAYA-P1.6A. `audit_log.entity_id` is a `uuid` column, and nothing checked what
 * was written into it. The Brand Center passed TEMPLATE KEYS — "EXECUTIVE",
 * "PRESENTATION", a document type — so Postgres rejected the insert, writeAudit
 * threw (deliberately: WES-9 makes a failed mandatory event abort its action),
 * and the whole server action died with a 500 the operator saw as
 * « Une erreur est survenue ».
 *
 * A business key is not an entity id. It belongs in `after`, where every one of
 * those call sites was already putting it. This check moves the failure from a
 * production Postgres error to a unit-testable boundary with a message that
 * names the offending value.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Machine events (Phase 1.15B): provider-webhook and TTL-sweep driven, with no
 * human actor. They are append-only-audited and attributed via the
 * provider_webhook_event row (provider_event_id), so — like "system." events —
 * they are allowed without an actorId. Staff/portal-initiated intent events
 * (payment_intent.created / .cancelled) are NOT here: they still require an actor.
 */
const SYSTEM_MACHINE_ACTIONS = new Set<string>([
  "payment_intent.succeeded",
  "payment_intent.failed",
  "payment_intent.expired",
  "provider.webhook.received",
  "provider.webhook.replayed",
  "payment.auto_recorded",
  // Phase 1.16 — an OAuth login rejected at the gate has, by definition, no
  // authenticated actor to attribute (the caller failed identity resolution).
  "auth.login.rejected",
  "portal.login.rejected",
  // Phase 3.4 — external GPS/carrier provider webhook (reserved; no human actor).
  "tracking.provider.webhook_received",
  // Phase EC-1 — inbound email arrives from a mail provider, not a person.
  // Attribution is the ec_webhook_event row (provider, provider_event_id).
  "ec.inbound.received",
  "ec.inbound.quarantined",
  "ec.inbound.rejected",
]);

export function isSystemAction(action: string): boolean {
  return action.startsWith("system.") || SYSTEM_MACHINE_ACTIONS.has(action);
}

/** Throws if the event violates the audit rules. Returns void on success. */
export function validateAuditEvent(event: AuditEventInput): void {
  if (!event.action || event.action.trim() === "") {
    throw new Error("[audit] action is required");
  }

  // Non-system actions must be attributed — to a staff actor (actorId), a portal
  // actor (clientUserId), or a platform actor (platformActorId). Fail closed.
  if (!isSystemAction(event.action) && !event.actorId && !event.clientUserId && !event.platformActorId) {
    throw new Error(
      `[audit] actorId, clientUserId, or platformActorId is required for non-system action "${event.action}"`,
    );
  }

  if (event.isOverride && !event.overrideReason) {
    throw new Error(
      `[audit] overrideReason is required for override action "${event.action}"`,
    );
  }

  // The column is a uuid. Say so here, in French-free engineer language, rather
  // than letting Postgres say it in the middle of a user's action.
  if (event.entityId != null && !isUuid(event.entityId)) {
    throw new Error(
      `[audit] entityId must be a UUID for action "${event.action}" — received "${event.entityId}". ` +
        `A business key (template key, type code) belongs in \`after\`, not in entity_id.`,
    );
  }
}

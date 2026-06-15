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
 */
export type AuditEventInput = {
  action: string;
  actorId?: string | null;
  /** portal (client_user) actor — an alternative to actorId for portal.* events */
  clientUserId?: string | null;
  isOverride?: boolean;
  overrideReason?: string | null;
};

export function isSystemAction(action: string): boolean {
  return action.startsWith("system.");
}

/** Throws if the event violates the audit rules. Returns void on success. */
export function validateAuditEvent(event: AuditEventInput): void {
  if (!event.action || event.action.trim() === "") {
    throw new Error("[audit] action is required");
  }

  // Non-system actions must be attributed — to a staff actor (actorId) OR, for
  // portal events, to a client_user actor (clientUserId). Fail closed otherwise.
  if (!isSystemAction(event.action) && !event.actorId && !event.clientUserId) {
    throw new Error(
      `[audit] actorId or clientUserId is required for non-system action "${event.action}"`,
    );
  }

  if (event.isOverride && !event.overrideReason) {
    throw new Error(
      `[audit] overrideReason is required for override action "${event.action}"`,
    );
  }
}

/**
 * Append-only audit write path (AUD-1 / AUD-2). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The single way privileged/state-changing actions are recorded. Inserts only —
 * audit_log additionally blocks UPDATE/DELETE at the DB level (triggers), so
 * append-only is enforced even here.
 *
 * Uses the admin (service-role) client because audit_log has no INSERT policy
 * for authenticated users — writes are trusted, server-side, and attributed.
 *
 * AUD-2 hardening:
 *  - Non-"system." actions REQUIRE an actorId (fail closed — no anonymous
 *    attribution for user actions).
 *  - Override actions (isOverride) REQUIRE an overrideReason (governance).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export type AuditEvent = {
  /** what happened, e.g. "user.role.assigned". Prefix "system." for unattributed system events. */
  action: string;
  /** tenant the event belongs to (null only for pre-tenant system events) */
  tenantId?: string | null;
  /** the acting user (app_user.id); REQUIRED unless action starts with "system." */
  actorId?: string | null;
  /** entity type touched, e.g. "app_user" */
  entity?: string | null;
  /** entity row id */
  entityId?: string | null;
  /** snapshot before the change */
  before?: unknown;
  /** snapshot after the change */
  after?: unknown;
  /** marks this as an override action — requires overrideReason */
  isOverride?: boolean;
  /** required when isOverride is true (governance) */
  overrideReason?: string | null;
};

function isSystemAction(action: string): boolean {
  return action.startsWith("system.");
}

/** Write one append-only audit entry. Throws on validation or write failure. */
export async function writeAudit(event: AuditEvent): Promise<void> {
  if (!event.action || event.action.trim() === "") {
    throw new Error("[audit] action is required");
  }

  // Fail closed: user actions must be attributed.
  if (!isSystemAction(event.action) && !event.actorId) {
    throw new Error(
      `[audit] actorId is required for non-system action "${event.action}"`,
    );
  }

  // Governance: overrides must carry a reason.
  if (event.isOverride && !event.overrideReason) {
    throw new Error(
      `[audit] overrideReason is required for override action "${event.action}"`,
    );
  }

  const supabase = getAdminSupabaseClient();
  const { error } = await supabase.from("audit_log").insert({
    action: event.action,
    tenant_id: event.tenantId ?? null,
    actor_id: event.actorId ?? null,
    entity: event.entity ?? null,
    entity_id: event.entityId ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
    override_reason: event.overrideReason ?? null,
  });

  if (error) {
    throw new Error(
      `[audit] failed to write audit event "${event.action}": ${error.message}`,
    );
  }
}

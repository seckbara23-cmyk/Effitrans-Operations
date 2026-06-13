/**
 * Append-only audit write path (AUD-1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The single way privileged/state-changing actions are recorded. Inserts only —
 * the audit_log table additionally blocks UPDATE/DELETE at the database level
 * (BEFORE UPDATE/DELETE triggers), so append-only is enforced even here.
 *
 * Uses the admin (service-role) client because audit_log has no INSERT policy
 * for authenticated users — writes are trusted, server-side, and attributed.
 *
 * Security requirement: ALL privileged audit events must be written through
 * this helper. No update/delete operations are exposed.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export type AuditEvent = {
  /** required: what happened, e.g. "user.role.assigned" */
  action: string;
  /** tenant the event belongs to (null only for pre-tenant system events) */
  tenantId?: string | null;
  /** the acting user (app_user.id); null only for unauthenticated system events */
  actorId?: string | null;
  /** entity type touched, e.g. "app_user" */
  entity?: string | null;
  /** entity row id */
  entityId?: string | null;
  /** snapshot before the change */
  before?: unknown;
  /** snapshot after the change */
  after?: unknown;
  /** required when this records an override (governance) */
  overrideReason?: string | null;
};

/** Write one append-only audit entry. Throws on failure (audit must not fail silently). */
export async function writeAudit(event: AuditEvent): Promise<void> {
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

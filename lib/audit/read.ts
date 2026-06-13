/**
 * Audit log read path (AUD-2). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Reads through the RLS-respecting USER-CONTEXT client (NOT the service role),
 * so the audit_log_select_scoped policy applies: only callers in their own
 * tenant holding 'audit:read:all' get rows. Read-only — no mutation here.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";

export type AuditEntry = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  overrideReason: string | null;
  occurredAt: string;
  actorEmail: string | null;
};

type AuditRow = {
  id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  override_reason: string | null;
  occurred_at: string;
  actor: { email: string | null } | null;
};

/** Most-recent audit entries visible to the caller (RLS-scoped). Read-only. */
export async function listAuditEntries(limit = 100): Promise<AuditEntry[]> {
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, entity, entity_id, override_reason, occurred_at, actor:actor_id(email)")
    .order("occurred_at", { ascending: false })
    .limit(limit)
    .returns<AuditRow[]>();

  if (error) {
    throw new Error(`[audit] failed to read audit log: ${error.message}`);
  }

  const rows = data ?? [];
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    overrideReason: r.override_reason,
    occurredAt: r.occurred_at,
    actorEmail: r.actor?.email ?? null,
  }));
}

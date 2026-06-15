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

export const AUDIT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export type AuditPage = { entries: AuditEntry[]; page: number; pageSize: number; hasMore: boolean };

/**
 * A page of audit entries visible to the caller (RLS-scoped). Read-only.
 * P1: bounded page size + offset pagination + a STABLE order (occurred_at, then
 * id as a tiebreaker) so paging can't drop/duplicate rows. Fetches pageSize+1 to
 * detect `hasMore` without a second count query.
 */
export async function listAuditEntries(page = 0, pageSize = AUDIT_PAGE_SIZE): Promise<AuditPage> {
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
  const from = Math.max(0, page) * size;
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, entity, entity_id, override_reason, occurred_at, actor:actor_id(email)")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + size) // size+1 rows to detect hasMore
    .returns<AuditRow[]>();

  if (error) {
    throw new Error(`[audit] failed to read audit log: ${error.message}`);
  }

  const rows = data ?? [];
  const hasMore = rows.length > size;
  const entries = rows.slice(0, size).map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    overrideReason: r.override_reason,
    occurredAt: r.occurred_at,
    actorEmail: r.actor?.email ?? null,
  }));
  return { entries, page: Math.max(0, page), pageSize: size, hasMore };
}

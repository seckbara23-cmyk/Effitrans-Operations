/**
 * Platform audit reader (Phase 4.0B-4). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Reads the `platform.*` slice of the shared append-only audit_log (D12 — one
 * audit system, safe namespaces). Gated by platform:audit:read; returns only
 * safe metadata (action, target tenant, entity) — audit payloads never carry
 * secrets or tenant operational data by construction.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission } from "./auth";

export type PlatformAuditEntry = {
  id: string;
  action: string;
  tenantId: string | null;
  entity: string | null;
  entityId: string | null;
  occurredAt: string;
};

export async function listPlatformAuditEvents(limit = 100): Promise<PlatformAuditEntry[]> {
  await assertPlatformPermission("platform:audit:read");
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("audit_log")
    .select("id, action, tenant_id, entity, entity_id, occurred_at")
    .like("action", "platform.%")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[platform] audit read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    action: r.action,
    tenantId: r.tenant_id,
    entity: r.entity,
    entityId: r.entity_id,
    occurredAt: r.occurred_at,
  }));
}

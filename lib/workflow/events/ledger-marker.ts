"use server";
/**
 * UT-3B — the ledger honesty marker. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * `HISTORICAL_EVENTS_NOT_BACKFILLED` is the seventh approved emitter and the
 * only one that needs no trigger, because **the statement IS the act**. There
 * is no business event preceding it to share a transaction with: emitting it is
 * itself the thing being recorded, so the single RPC call is the whole
 * transaction. That is why its registry emission is `rpc` and not `trigger`.
 *
 * WHAT IT SAYS. "This tenant's ledger begins here. Anything that happened
 * before this instant was never recorded as an event and has NOT been
 * reconstructed." It exists so a timeline can state its own incompleteness
 * rather than letting an empty early period read as a quiet period —
 * ADR-UT-7, and the reason the platform never backfills.
 *
 * ONCE PER TENANT. Re-running is refused by reading the ledger first, not by a
 * unique constraint: a second marker would claim a second beginning.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";

export type LedgerMarkerResult =
  | { ok: true; alreadyRecorded: boolean }
  | { ok: false; error: string };

/**
 * Record the marker for the caller's tenant.
 *
 * Gated on `admin:config:manage` — the same authority that reads configuration
 * history, which is exactly who this statement is addressed to. **No permission
 * was created for it.**
 */
export async function recordLedgerStartMarker(): Promise<LedgerMarkerResult> {
  let user;
  try { user = await assertPermission("admin:config:manage"); }
  catch { return { ok: false, error: "forbidden" }; }

  const admin = getAdminSupabaseClient();

  // Already stated? Then say so and change nothing. A ledger has one beginning.
  const { count } = await admin
    .from("business_event")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("event_type", "HISTORICAL_EVENTS_NOT_BACKFILLED");
  if ((count ?? 0) > 0) return { ok: true, alreadyRecorded: true };

  // The earliest event we hold — the honest boundary of what IS recorded.
  const { data: earliest } = await admin
    .from("business_event")
    .select("occurred_at")
    .eq("tenant_id", user.tenantId)
    .order("occurred_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { error } = await admin.rpc("emit_business_event", {
    p_tenant_id: user.tenantId,
    p_event_type: "HISTORICAL_EVENTS_NOT_BACKFILLED",
    p_event_domain: "ledger",
    p_source: "app_action",
    p_subject_type: "organization",
    p_subject_id: user.tenantId,
    p_dossier_id: null,
    p_actor_user_id: user.id,
    // The only key the registry allows for this type.
    p_metadata: {
      ledger_started_at:
        (earliest as { occurred_at?: string } | null)?.occurred_at ?? new Date().toISOString(),
    },
  });
  if (error) return { ok: false, error: "emit_failed" };

  await writeAudit({
    action: "ledger.start_marker_recorded",
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "business_event",
    entityId: user.tenantId,
  });

  return { ok: true, alreadyRecorded: false };
}

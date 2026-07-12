/**
 * Shared DELIVERED transition (Phase 3.4C-3). SERVER-ONLY (not a server action).
 * ---------------------------------------------------------------------------
 * The single DELIVERED path — same state machine (canTransition), same audit
 * (transport.delivered), same IDEMPOTENT customer notification (custDelivered) as
 * the staff changeTransportStatus. The driver delivery flow calls this after an
 * ASSIGNMENT authorization check (drivers hold no transport:complete). It does
 * NOT advance POD_RECEIVED or fire the Finance handoff — that stays the staff
 * POD-approval step, so tracking evidence never auto-advances finance.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { custDelivered } from "@/lib/customer-notify/triggers";
import { canTransition } from "./status";
import type { ActionResult, TransportStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

export async function deliverTransport(
  supabase: Admin,
  actor: { id: string; tenantId: string },
  rec: { id: string; file_id: string; status: string },
  deliveredAt?: string,
): Promise<ActionResult> {
  const from = rec.status as TransportStatus;
  if (!canTransition(from, "DELIVERED")) return { ok: false, error: "invalid_transition" };
  const { error } = await supabase
    .from("transport_record")
    .update({ status: "DELIVERED", delivery_actual: deliveredAt ?? new Date().toISOString() })
    .eq("id", rec.id)
    .eq("tenant_id", actor.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TRANSPORT_DELIVERED,
    actorId: actor.id,
    tenantId: actor.tenantId,
    entity: "transport_record",
    entityId: rec.id,
    before: { status: from },
    after: { status: "DELIVERED" },
  });
  // Reuse the existing idempotent customer "delivered" notification.
  await custDelivered(supabase, { tenantId: actor.tenantId, actorId: actor.id }, rec.file_id);
  revalidatePath(`/files/${rec.file_id}`);
  revalidatePath("/transport");
  return { ok: true, id: rec.id };
}

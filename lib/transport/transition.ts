/**
 * Shared DELIVERED transition (Phase 3.4C-3). SERVER-ONLY (not a server action).
 * ---------------------------------------------------------------------------
 * The single DELIVERED path — same state machine (canTransition), same audit
 * (transport.delivered), same IDEMPOTENT customer notification (custDelivered) as
 * the staff changeTransportStatus. The driver delivery flow calls this after an
 * ASSIGNMENT authorization check (drivers hold no transport:complete).
 *
 * ===========================================================================
 * EFF-POD-FINANCE-CONVERGENCE-01 — the consequences of DELIVERED, once
 * ===========================================================================
 * This function used to stop at custDelivered, noting that it did not advance
 * the dossier or fire the Finance handoff, "so tracking evidence never
 * auto-advances finance". That INTENT is right and is kept in full. The
 * IMPLEMENTATION, however, made the outcome depend on WHO recorded the same
 * fact:
 *
 *   office records DELIVERED  ->  dossier advances, POD receipt is retried
 *   driver records DELIVERED  ->  neither ever happens
 *
 * So a driver-confirmed delivery left operational_file at IN_PROGRESS while the
 * lifecycle — which reads transport — already offered closure; and a delivery
 * note verified BEFORE the run was delivered could never be picked up at all,
 * because its only retry moment lived inside the staff branch.
 *
 * The two calls below are the SAME governed services the staff branch invokes,
 * in the same order. Nothing about tracking advances anything:
 *   - advanceFileToDeliveredFromTransport only follows the transport fact that
 *     has just committed above, and is a no-op outside OPENED/IN_PROGRESS;
 *   - recordPodReceiptFromVerifiedEvidence re-applies canReceivePod over the
 *     isVerified documents, so POD_RECEIVED stays impossible without the
 *     verified DELIVERY_NOTE a manual receipt would have required, approved by
 *     a different seat under maker-checker. A GPS fix, a signature photo or a
 *     recipient name does not satisfy that gate and never will.
 *
 * Both are convergent, idempotent (compare-and-set) and NEVER THROW, so a
 * downstream failure can never undo the delivery that already committed.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { custDelivered } from "@/lib/customer-notify/triggers";
import { advanceFileToDeliveredFromTransport } from "@/lib/files/auto-advance";
import { canTransition } from "./status";
import { recordPodReceiptFromVerifiedEvidence } from "./pod-receipt";
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

  // ATOMIC. The status predicate makes this a compare-and-set on the very row
  // version the caller's `canTransition` was decided against, so of two
  // simultaneous confirmations exactly ONE can move the record. Without it both
  // passed the in-memory check and both wrote, which left two
  // `transport.delivered` audit rows claiming the same transition — and the
  // office branch already refused that case through its own `updated_at`
  // compare-and-set. `.select("id")` is what makes the outcome observable:
  // PostgREST reports no error for an UPDATE that matched nothing.
  //
  // THE LOSER RETURNS A REFUSAL, and everything that would claim a delivery
  // happens after this point: the audit row, the customer notice, the dossier
  // advance, the POD retry, and — in the caller — the DELIVERED tracking event
  // and the session completion, which `confirmDelivery` reaches only through
  // `if (!delivered.ok) return delivered;`. A losing or stale request therefore
  // writes nothing at all and invents no delivery timestamp.
  const { data: moved, error } = await supabase
    .from("transport_record")
    .update({ status: "DELIVERED", delivery_actual: deliveredAt ?? new Date().toISOString() })
    .eq("id", rec.id)
    .eq("tenant_id", actor.tenantId)
    .eq("status", from)
    .select("id");
  if (error) return { ok: false, error: error.message };
  // `invalid_transition` rather than a new code: at the moment of the write the
  // transition from the status we read was no longer available, which is what
  // that refusal already means, and the driver lane already has a precise
  // French sentence for it. A retry then meets `deliveryBlock` first and is
  // told `already_delivered`, which is the more specific truth once committed.
  if ((moved?.length ?? 0) !== 1) return { ok: false, error: "invalid_transition" };

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

  // The dossier status FOLLOWS the transport fact — the same reason the staff
  // branch does this. Without it the two engines disagree: the lifecycle reads
  // transport and advertises closure while operational_file is still
  // IN_PROGRESS, whose only legal next step is DELIVERED.
  await advanceFileToDeliveredFromTransport({
    supabase,
    tenantId: actor.tenantId,
    fileId: rec.file_id,
    actorId: actor.id,
  });

  // CONVERGENCE. If the delivery note was verified BEFORE the run reached
  // DELIVERED, the receipt could not fire then — it refused with
  // `not_delivered`. Recording DELIVERED is the moment it becomes possible, so
  // it is retried here exactly as the staff branch retries it. No
  // re-verification is ever required and the same evidence gate applies, so
  // with no qualifying verified evidence this reports `evidence_missing` and
  // changes nothing at all.
  await recordPodReceiptFromVerifiedEvidence({
    supabase,
    tenantId: actor.tenantId,
    fileId: rec.file_id,
    actorId: actor.id,
  });

  revalidatePath(`/files/${rec.file_id}`);
  revalidatePath("/transport");
  return { ok: true, id: rec.id };
}

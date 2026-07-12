"use server";

/**
 * Driver delivery confirmation & POD capture (Phase 3.4C-3). SERVER ACTION.
 * ---------------------------------------------------------------------------
 * The explicit "confirm delivery" step. It REUSES the existing transport
 * transition (deliverTransport → same state machine, audit, and idempotent
 * customer notification) and the existing DELIVERY_NOTE/POD document workflow —
 * no second delivery workflow, no second POD table.
 *
 * INVARIANTS
 *  - Authority is ASSIGNMENT (driver_user_id === caller), never a permission.
 *  - Geolocation/geofence ALONE never marks delivered: this requires an explicit
 *    call + a recipient name (required evidence).
 *  - Duplicate-safe: canTransition rejects a second DELIVERED, and the DELIVERED
 *    event carries a per-transport dedup_key.
 *  - The tracking session is completed ONLY after the DELIVERED transition
 *    succeeds — a failed transition leaves the session live.
 *  - Finance handoff is NOT fired here; it stays the staff POD_RECEIVED approval
 *    step (driver POD scans land in PENDING_REVIEW).
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { driverMobileTrackingEnabled } from "@/lib/tracking/config";
import { isValidCoordinate } from "@/lib/tracking/position";
import type { TrackingActionResult } from "@/lib/tracking/types";
import { deliverTransport } from "@/lib/transport/transition";
import { deliveredDedupKey } from "./event-kinds";
import { driverContext, loadAssignedTransport, currentSession } from "./mission-auth";

const FUTURE_SKEW_MS = 120_000;

export type ConfirmDeliveryInput = {
  recipientName: string;
  customerMessage?: string | null;
  deliveredAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  signatureDocId?: string | null;
  photoDocIds?: string[] | null;
};

export async function confirmDelivery(transportId: string, input: ConfirmDeliveryInput): Promise<TrackingActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverContext();
  if (!user) return { ok: false, error: "forbidden" };

  const recipientName = input.recipientName?.trim();
  if (!recipientName) return { ok: false, error: "recipient_required" }; // required evidence

  const supabase = getAdminSupabaseClient();
  const rec = await loadAssignedTransport(supabase, user, transportId);
  if (!rec) return { ok: false, error: "forbidden" };
  const sess = await currentSession(supabase, user, transportId);
  if (!sess) return { ok: false, error: "no_session" };

  // Timestamp + coordinates.
  const now = Date.now();
  let deliveredAt = new Date(now).toISOString();
  if (input.deliveredAt) {
    const t = new Date(input.deliveredAt).getTime();
    if (Number.isNaN(t) || t > now + FUTURE_SKEW_MS) return { ok: false, error: "invalid_timestamp" };
    deliveredAt = new Date(t).toISOString();
  }
  let lat: number | null = null;
  let lng: number | null = null;
  if (input.latitude != null && input.longitude != null) {
    if (!isValidCoordinate(input.latitude, input.longitude)) return { ok: false, error: "invalid_coordinate" };
    lat = input.latitude;
    lng = input.longitude;
  }

  // Validate any referenced evidence belongs to THIS dossier and driver.
  const referenced = [input.signatureDocId, ...(input.photoDocIds ?? [])].filter((x): x is string => Boolean(x));
  let signaturePresent = false;
  let photoCount = 0;
  if (referenced.length > 0) {
    const { data: docs } = await supabase
      .from("document")
      .select("id, type_code")
      .in("id", referenced)
      .eq("tenant_id", user.tenantId)
      .eq("file_id", rec.file_id)
      .eq("uploaded_by", user.id)
      .is("deleted_at", null);
    const valid = docs ?? [];
    signaturePresent = valid.some((d) => d.type_code === "DRIVER_SIGNATURE");
    photoCount = valid.filter((d) => d.type_code !== "DRIVER_SIGNATURE").length;
  }

  // 1) DELIVERED transition FIRST — reuses the shared path; duplicate-guarded by
  //    canTransition. If this fails we return WITHOUT completing the session.
  const delivered = await deliverTransport(supabase, { id: user.id, tenantId: user.tenantId }, rec, deliveredAt);
  if (!delivered.ok) return delivered;

  // 2) Customer-visible DELIVERED evidence event. Recipient/POD detail is INTERNAL
  //    (detail jsonb); the customer only sees the generic confirmation message.
  await supabase
    .from("tracking_event")
    .insert({
      tenant_id: user.tenantId,
      file_id: rec.file_id,
      transport_id: transportId,
      tracking_session_id: sess.id,
      type: "DELIVERED",
      source: "driver_mobile",
      customer_visible: true,
      customer_message: input.customerMessage?.trim() || "Livraison effectuée.",
      detail: { recipientName, deliveredAt, signaturePresent, photoCount, latitude: lat, longitude: lng },
      latitude: lat,
      longitude: lng,
      occurred_at: deliveredAt,
      dedup_key: deliveredDedupKey(transportId),
      created_by: user.id,
    });

  // 3) Complete the session — ONLY reached because the transition succeeded.
  await supabase
    .from("tracking_session")
    .update({ status: "COMPLETED", ended_at: new Date().toISOString() })
    .eq("id", sess.id)
    .eq("tenant_id", user.tenantId)
    .in("status", ["ACTIVE", "PAUSED"]);
  await writeAudit({ action: AuditActions.TRACKING_SESSION_COMPLETED, actorId: user.id, tenantId: user.tenantId, entity: "tracking_session", entityId: sess.id, after: { reason: "delivered" } });
  await supabase.from("tracking_event").insert({
    tenant_id: user.tenantId,
    file_id: rec.file_id,
    transport_id: transportId,
    tracking_session_id: sess.id,
    type: "TRACKING_STOPPED",
    source: "driver_mobile",
    customer_visible: false,
    created_by: user.id,
  });

  revalidatePath(`/driver/missions/${transportId}`);
  revalidatePath("/driver");
  return { ok: true, id: rec.id };
}

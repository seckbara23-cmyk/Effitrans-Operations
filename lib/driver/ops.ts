"use server";

/**
 * Driver operational events, delay & incident reporting (Phase 3.4C-3). ACTIONS.
 * ---------------------------------------------------------------------------
 * Driver-authorized (assignment + live session) writes to tracking_event. These
 * are EVIDENCE only — they never change transport status. Customer-safe copy
 * (customer_message, shown in the portal when customer_visible) is kept SEPARATE
 * from internal detail (internal_note, detail jsonb) which NEVER reaches the
 * portal. Delay/incident notify the dispatch owners via the existing inbox and
 * are deduplicated. Audited via the existing tracking.* codes.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { driverMobileTrackingEnabled } from "@/lib/tracking/config";
import { isCustomerSafeByDefault } from "@/lib/tracking/events";
import { isValidCoordinate } from "@/lib/tracking/position";
import type { TrackingActionResult, TrackingEventType } from "@/lib/tracking/types";
import { driverContext, loadAssignedTransport, currentSession, notifyDispatchers } from "./mission-auth";
import { isDriverEventKind, isDelayCategory, isIncidentCategory, isIncidentSeverity, delayDedupKey } from "./event-kinds";

const FUTURE_SKEW_MS = 120_000;

function occurredAtOr(now: number, iso?: string | null): { ok: true; value: string } | { ok: false } {
  if (!iso) return { ok: true, value: new Date(now).toISOString() };
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || t > now + FUTURE_SKEW_MS) return { ok: false };
  return { ok: true, value: new Date(t).toISOString() };
}

function coords(lat?: number | null, lng?: number | null): { lat: number | null; lng: number | null } | null {
  if (lat == null || lng == null) return { lat: null, lng: null };
  if (!isValidCoordinate(lat, lng)) return null;
  return { lat, lng };
}

export type DriverEventInput = {
  type: string;
  customerVisible?: boolean;
  customerMessage?: string | null;
  internalNote?: string | null;
  occurredAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export async function recordDriverEvent(transportId: string, input: DriverEventInput): Promise<TrackingActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverContext();
  if (!user) return { ok: false, error: "forbidden" };
  if (!isDriverEventKind(input.type)) return { ok: false, error: "invalid_type" };
  const type = input.type as TrackingEventType;

  const supabase = getAdminSupabaseClient();
  const rec = await loadAssignedTransport(supabase, user, transportId);
  if (!rec) return { ok: false, error: "forbidden" };
  const sess = await currentSession(supabase, user, transportId);
  if (!sess) return { ok: false, error: "no_session" };

  const oc = occurredAtOr(Date.now(), input.occurredAt);
  if (!oc.ok) return { ok: false, error: "invalid_timestamp" };
  const c = coords(input.latitude, input.longitude);
  if (!c) return { ok: false, error: "invalid_coordinate" };

  const { data, error } = await supabase
    .from("tracking_event")
    .insert({
      tenant_id: user.tenantId,
      file_id: rec.file_id,
      transport_id: transportId,
      tracking_session_id: sess.id,
      type,
      source: "driver_mobile",
      customer_visible: input.customerVisible ?? isCustomerSafeByDefault(type),
      customer_message: input.customerMessage?.trim() || null,
      internal_note: input.internalNote?.trim() || null,
      latitude: c.lat,
      longitude: c.lng,
      occurred_at: oc.value,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({ action: AuditActions.TRACKING_EVENT_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "tracking_event", entityId: data.id, after: { type, source: "driver_mobile" } });
  revalidatePath(`/driver/missions/${transportId}`);
  return { ok: true, id: data.id };
}

export type DelayInput = {
  category: string;
  customerMessage: string;
  internalNote?: string | null;
  expectedDelayMinutes?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

export async function reportDelay(transportId: string, input: DelayInput): Promise<TrackingActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverContext();
  if (!user) return { ok: false, error: "forbidden" };
  if (!isDelayCategory(input.category)) return { ok: false, error: "invalid_category" };
  const customerMessage = input.customerMessage?.trim();
  if (!customerMessage) return { ok: false, error: "message_required" };

  const supabase = getAdminSupabaseClient();
  const rec = await loadAssignedTransport(supabase, user, transportId);
  if (!rec) return { ok: false, error: "forbidden" };
  const sess = await currentSession(supabase, user, transportId);
  if (!sess) return { ok: false, error: "no_session" };

  const c = coords(input.latitude, input.longitude);
  if (!c) return { ok: false, error: "invalid_coordinate" };
  const expected = typeof input.expectedDelayMinutes === "number" && Number.isFinite(input.expectedDelayMinutes) && input.expectedDelayMinutes >= 0 ? Math.floor(input.expectedDelayMinutes) : null;
  // Dedup: one delay per (transport, category) per 10-minute bucket (double-tap safe).
  const dedupKey = delayDedupKey(transportId, input.category, Date.now());

  const { data, error } = await supabase
    .from("tracking_event")
    .insert({
      tenant_id: user.tenantId,
      file_id: rec.file_id,
      transport_id: transportId,
      tracking_session_id: sess.id,
      type: "DELAY_REPORTED",
      source: "driver_mobile",
      customer_visible: true,
      customer_message: customerMessage,
      internal_note: input.internalNote?.trim() || null,
      detail: { category: input.category, expectedDelayMinutes: expected },
      latitude: c.lat,
      longitude: c.lng,
      dedup_key: dedupKey,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error && /duplicate|unique/i.test(error.message)) return { ok: true }; // deduped
    return { ok: false, error: error?.message ?? "create_failed" };
  }

  await writeAudit({ action: AuditActions.TRACKING_DELAY_REPORTED, actorId: user.id, tenantId: user.tenantId, entity: "tracking_event", entityId: data.id, after: { category: input.category } });
  await notifyDispatchers(supabase, user.tenantId, rec.file_id, "Retard signalé", customerMessage);
  revalidatePath(`/driver/missions/${transportId}`);
  return { ok: true, id: data.id };
}

export type IncidentInput = {
  category: string;
  severity: string;
  internalNote: string;
  customerMessage?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export async function reportIncident(transportId: string, input: IncidentInput): Promise<TrackingActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverContext();
  if (!user) return { ok: false, error: "forbidden" };
  if (!isIncidentCategory(input.category)) return { ok: false, error: "invalid_category" };
  if (!isIncidentSeverity(input.severity)) return { ok: false, error: "invalid_severity" };
  const internalNote = input.internalNote?.trim();
  if (!internalNote) return { ok: false, error: "detail_required" };

  const supabase = getAdminSupabaseClient();
  const rec = await loadAssignedTransport(supabase, user, transportId);
  if (!rec) return { ok: false, error: "forbidden" };
  const sess = await currentSession(supabase, user, transportId);
  if (!sess) return { ok: false, error: "no_session" };

  const c = coords(input.latitude, input.longitude);
  if (!c) return { ok: false, error: "invalid_coordinate" };
  const customerMessage = input.customerMessage?.trim() || null;

  const { data, error } = await supabase
    .from("tracking_event")
    .insert({
      tenant_id: user.tenantId,
      file_id: rec.file_id,
      transport_id: transportId,
      tracking_session_id: sess.id,
      type: "INCIDENT_REPORTED",
      source: "driver_mobile",
      // Internal by default — only visible to the client when a customer-safe message is provided.
      customer_visible: Boolean(customerMessage),
      customer_message: customerMessage,
      internal_note: internalNote,
      detail: { category: input.category, severity: input.severity },
      latitude: c.lat,
      longitude: c.lng,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({ action: AuditActions.TRACKING_INCIDENT_REPORTED, actorId: user.id, tenantId: user.tenantId, entity: "tracking_event", entityId: data.id, after: { category: input.category, severity: input.severity } });
  await notifyDispatchers(supabase, user.tenantId, rec.file_id, `Incident signalé — ${input.severity}`, `${input.category} : ${internalNote}`);
  revalidatePath(`/driver/missions/${transportId}`);
  return { ok: true, id: data.id };
}

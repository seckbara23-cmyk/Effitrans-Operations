"use server";

/**
 * Manual operations tracking updates (Phase 3.4B). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Not every trip has a GPS driver: ops staff record manual updates (Departed,
 * At checkpoint/border/warehouse, Delayed, Arrived) — labeled in the UI as
 * "Mise à jour manuelle par Effitrans", stored source='manual'. These are
 * EVIDENCE over the lifecycle: they NEVER transition the dossier and NEVER
 * touch finance (DEC-A02). Delivery stays the existing transport lifecycle
 * transition (no second delivery workflow). Gate: tracking:write + TRACKING_
 * ENABLED + dossier visibility; write via the service-role admin client; audit;
 * revalidate. No customer notification here — customer-visible events surface
 * through the portal tracking timeline (later increment), not a duplicate feed.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { trackingEnabled } from "./config";
import { isCustomerSafeByDefault, isManualUpdateKind } from "./events";
import { isValidCoordinate, validatePosition } from "./position";
import type { TrackingActionResult, TrackingEventType } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

const FUTURE_SKEW_MS = 120_000;

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath("/transport");
}

/** The transport row for a dossier (to link the tracking row), or null. */
async function transportIdForFile(supabase: Admin, tenantId: string, fileId: string): Promise<string | null> {
  const { data } = await supabase
    .from("transport_record")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .is("deleted_at", null)
    .maybeSingle();
  return data?.id ?? null;
}

export type ManualTrackingEventInput = {
  type: string;
  customerVisible?: boolean;
  customerMessage?: string | null;
  internalNote?: string | null;
  occurredAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export async function recordManualTrackingEvent(
  fileId: string,
  input: ManualTrackingEventInput,
): Promise<TrackingActionResult> {
  if (!trackingEnabled()) return { ok: false, error: "tracking_disabled" };
  let user;
  try {
    user = await assertPermission("tracking:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!isManualUpdateKind(input.type)) return { ok: false, error: "invalid_type" };
  const type = input.type as TrackingEventType;
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return { ok: false, error: "forbidden" };

  // occurred_at: optional; must be valid and not in the future (allow clock skew).
  const now = Date.now();
  let occurredAt = new Date(now).toISOString();
  if (input.occurredAt) {
    const t = new Date(input.occurredAt).getTime();
    if (Number.isNaN(t)) return { ok: false, error: "invalid_timestamp" };
    if (t > now + FUTURE_SKEW_MS) return { ok: false, error: "future_timestamp" };
    occurredAt = new Date(t).toISOString();
  }

  // Optional coordinates (where the event occurred, if consented).
  let lat: number | null = null;
  let lng: number | null = null;
  if (input.latitude != null && input.longitude != null) {
    if (!isValidCoordinate(input.latitude, input.longitude)) return { ok: false, error: "invalid_coordinate" };
    lat = input.latitude;
    lng = input.longitude;
  }

  const customerVisible = input.customerVisible ?? isCustomerSafeByDefault(type);
  const supabase = getAdminSupabaseClient();
  const transportId = await transportIdForFile(supabase, user.tenantId, fileId);

  const { data, error } = await supabase
    .from("tracking_event")
    .insert({
      tenant_id: user.tenantId,
      file_id: fileId,
      transport_id: transportId,
      type,
      source: "manual",
      customer_visible: customerVisible,
      customer_message: input.customerMessage?.trim() || null,
      internal_note: input.internalNote?.trim() || null,
      latitude: lat,
      longitude: lng,
      occurred_at: occurredAt,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({
    action: type === "DELAY_REPORTED" ? AuditActions.TRACKING_DELAY_REPORTED : AuditActions.TRACKING_EVENT_CREATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "tracking_event",
    entityId: data.id,
    after: { type, source: "manual", customer_visible: customerVisible },
  });
  revalidate(fileId);
  return { ok: true, id: data.id };
}

export type ManualPositionInput = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  recordedAt?: string | null;
  customerVisible?: boolean;
};

/** Record a manual last-known position (source='manual') — evidence for the map. */
export async function recordManualPosition(
  fileId: string,
  input: ManualPositionInput,
): Promise<TrackingActionResult> {
  if (!trackingEnabled()) return { ok: false, error: "tracking_disabled" };
  let user;
  try {
    user = await assertPermission("tracking:write");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return { ok: false, error: "forbidden" };

  const now = new Date();
  const recordedAt = input.recordedAt || now.toISOString();
  const check = validatePosition({ latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters, recordedAt }, now);
  if (!check.ok) return { ok: false, error: check.reason };

  const supabase = getAdminSupabaseClient();
  const transportId = await transportIdForFile(supabase, user.tenantId, fileId);

  const { data, error } = await supabase
    .from("tracking_position")
    .insert({
      tenant_id: user.tenantId,
      file_id: fileId,
      transport_id: transportId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy_meters: input.accuracyMeters ?? null,
      source: "manual",
      customer_visible: input.customerVisible ?? false,
      recorded_at: recordedAt,
      recorded_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({
    action: AuditActions.TRACKING_POSITION_MANUAL_RECORDED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "tracking_position",
    entityId: data.id,
    after: { source: "manual", customer_visible: input.customerVisible ?? false },
  });
  revalidate(fileId);
  return { ok: true, id: data.id };
}

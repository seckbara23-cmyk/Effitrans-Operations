/**
 * Tracking reads (Phase 3.4). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Service-role admin client gated by assertPermission('tracking:read') + dossier
 * visibility (isFileVisible). The tracking_* RLS policies (tenant + tracking:read
 * + can_read_file, OR assigned-driver, OR portal customer-visible) are the
 * CI-tested boundary. DARK BY DEFAULT: with TRACKING_ENABLED off these return
 * empty so nothing surfaces even if rows somehow exist. List views fetch only the
 * latest position (indexed) — never the full route (Deliverable 23).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { trackingEnabled } from "./config";
import type { LatestPosition, TrackingEventEntry, TrackingEventType, TrackingSource } from "./types";

/** Internal timeline: all tracking events for a dossier, newest first. */
export async function getTrackingTimeline(fileId: string): Promise<TrackingEventEntry[]> {
  if (!trackingEnabled()) return [];
  const user = await assertPermission("tracking:read");
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return [];

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("tracking_event")
    .select("id, type, source, customer_visible, customer_message, internal_note, occurred_at, created_by")
    .eq("tenant_id", user.tenantId)
    .eq("file_id", fileId)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`[tracking] timeline read failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    type: r.type as TrackingEventType,
    source: r.source as TrackingSource,
    customerVisible: r.customer_visible,
    customerMessage: r.customer_message,
    internalNote: r.internal_note,
    occurredAt: r.occurred_at,
    createdBy: r.created_by,
  }));
}

/** Latest known position for a dossier (list/detail views fetch only this one). */
export async function getLatestTrackingPosition(fileId: string): Promise<LatestPosition | null> {
  if (!trackingEnabled()) return null;
  const user = await assertPermission("tracking:read");
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return null;

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("tracking_position")
    .select("latitude, longitude, accuracy_meters, speed_kph, source, recorded_at, customer_visible")
    .eq("tenant_id", user.tenantId)
    .eq("file_id", fileId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[tracking] latest position read failed: ${error.message}`);
  if (!data) return null;

  return {
    latitude: data.latitude,
    longitude: data.longitude,
    accuracyMeters: data.accuracy_meters,
    speedKph: data.speed_kph,
    source: data.source as TrackingSource,
    recordedAt: data.recorded_at,
    customerVisible: data.customer_visible,
  };
}

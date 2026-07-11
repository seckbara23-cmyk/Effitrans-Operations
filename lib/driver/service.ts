/**
 * Driver mission reads (Phase 3.4C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * A driver sees ONLY transports assigned to them (transport_record.driver_user_id
 * = their app_user id). Reads use the service-role admin client but are HARD-gated
 * by that assignment in every query, and project a CUSTOMER-SAFE view only — no
 * finance, customs, tasks, audit, or other drivers' data. Health is derived on
 * read (lib/tracking/health). No N+1: transports + their latest session in two
 * bounded queries (list); the latest position is read from session.last_position_at.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireDriver } from "./auth";
import { classifyTrackingHealth, type TrackingHealth } from "@/lib/tracking/health";
import { buildMapPoints, type MapPoint } from "@/lib/portal/map-points";
import type { TransportStatus } from "@/lib/transport/types";
import type { TrackingEventEntry, TrackingSessionStatus } from "@/lib/tracking/types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

export type DriverMission = {
  transportId: string;
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  status: TransportStatus;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  pickupPlanned: string | null;
  deliveryPlanned: string | null;
  deliveryActual: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  sessionId: string | null;
  sessionStatus: TrackingSessionStatus | null;
  lastPositionAt: string | null;
  trackingHealth: TrackingHealth;
};

export type MissionDetail = DriverMission & {
  events: TrackingEventEntry[];
  mapPoints: MapPoint[];
  hasGeo: boolean;
  latestPosition: { latitude: number; longitude: number; recordedAt: string } | null;
};

const TRANSPORT_COLS =
  "id, file_id, status, pickup_location, delivery_location, pickup_planned, delivery_planned, delivery_actual, vehicle_plate, driver_name, file:file_id(file_number, client:client_id(name))";

type TransportRow = {
  id: string;
  file_id: string;
  status: string;
  pickup_location: string | null;
  delivery_location: string | null;
  pickup_planned: string | null;
  delivery_planned: string | null;
  delivery_actual: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  file: { file_number: string | null; client: { name: string } | null } | null;
};
type SessionRow = { id: string; transport_id: string | null; status: string; last_position_at: string | null; started_at: string };

/** The current/most-recent session for a transport (ACTIVE preferred, else latest). */
function pickSession(rows: SessionRow[], transportId: string): SessionRow | null {
  const forTransport = rows.filter((s) => s.transport_id === transportId);
  if (forTransport.length === 0) return null;
  const active = forTransport.find((s) => s.status === "ACTIVE" || s.status === "PAUSED");
  return active ?? forTransport[0]; // rows are ordered started_at desc
}

function toMission(r: TransportRow, session: SessionRow | null, now: Date): DriverMission {
  return {
    transportId: r.id,
    fileId: r.file_id,
    fileNumber: r.file?.file_number ?? null,
    clientName: r.file?.client?.name ?? null,
    status: r.status as TransportStatus,
    pickupLocation: r.pickup_location,
    deliveryLocation: r.delivery_location,
    pickupPlanned: r.pickup_planned,
    deliveryPlanned: r.delivery_planned,
    deliveryActual: r.delivery_actual,
    vehiclePlate: r.vehicle_plate,
    driverName: r.driver_name,
    sessionId: session?.id ?? null,
    sessionStatus: (session?.status as TrackingSessionStatus | undefined) ?? null,
    lastPositionAt: session?.last_position_at ?? null,
    trackingHealth: classifyTrackingHealth({
      sessionStatus: (session?.status as TrackingSessionStatus | undefined) ?? null,
      lastPositionAt: session?.last_position_at ?? null,
      now,
    }),
  };
}

/** All missions assigned to the authenticated driver (customer-safe). */
export async function listDriverMissions(): Promise<DriverMission[]> {
  const user = await requireDriver();
  const supabase = getAdminSupabaseClient();

  const { data: transports } = await supabase
    .from("transport_record")
    .select(TRANSPORT_COLS)
    .eq("tenant_id", user.tenantId)
    .eq("driver_user_id", user.id)
    .is("deleted_at", null)
    .order("delivery_planned", { ascending: true, nullsFirst: false })
    .returns<TransportRow[]>();

  const rows = transports ?? [];
  if (rows.length === 0) return [];

  const { data: sessions } = await supabase
    .from("tracking_session")
    .select("id, transport_id, status, last_position_at, started_at")
    .eq("tenant_id", user.tenantId)
    .in("transport_id", rows.map((r) => r.id))
    .order("started_at", { ascending: false })
    .returns<SessionRow[]>();

  const now = new Date();
  return rows.map((r) => toMission(r, pickSession(sessions ?? [], r.id), now));
}

/** One assigned mission with events + map points, or null if not assigned to this driver. */
export async function getDriverMission(transportId: string): Promise<MissionDetail | null> {
  const user = await requireDriver();
  const supabase = getAdminSupabaseClient();

  const { data: transport } = await supabase
    .from("transport_record")
    .select(TRANSPORT_COLS)
    .eq("id", transportId)
    .eq("tenant_id", user.tenantId)
    .eq("driver_user_id", user.id) // assignment gate
    .is("deleted_at", null)
    .maybeSingle<TransportRow>();
  if (!transport) return null;

  const [{ data: sessions }, { data: pos }, { data: events }] = await Promise.all([
    supabase.from("tracking_session").select("id, transport_id, status, last_position_at, started_at").eq("tenant_id", user.tenantId).eq("transport_id", transportId).order("started_at", { ascending: false }).returns<SessionRow[]>(),
    supabase.from("tracking_position").select("latitude, longitude, recorded_at").eq("tenant_id", user.tenantId).eq("transport_id", transportId).order("recorded_at", { ascending: false }).limit(1).maybeSingle<{ latitude: number; longitude: number; recorded_at: string }>(),
    supabase.from("tracking_event").select("id, type, source, customer_visible, customer_message, internal_note, occurred_at, created_by").eq("tenant_id", user.tenantId).eq("file_id", transport.file_id).order("occurred_at", { ascending: false }).limit(30),
  ]);

  const now = new Date();
  const mission = toMission(transport, pickSession(sessions ?? [], transportId), now);
  const latestPosition = pos ? { latitude: pos.latitude, longitude: pos.longitude, recordedAt: pos.recorded_at } : null;
  const progressPercent = mission.status === "DELIVERED" || mission.status === "POD_RECEIVED" ? 100 : mission.status === "NOT_STARTED" || mission.status === "PLANNED" ? 0 : 50;
  const { points, hasGeo } = buildMapPoints({
    origin: mission.pickupLocation,
    destination: mission.deliveryLocation,
    progressPercent,
    livePosition: latestPosition ? { latitude: latestPosition.latitude, longitude: latestPosition.longitude, recordedAt: latestPosition.recordedAt, source: "driver_mobile" } : null,
  });

  return {
    ...mission,
    events: (events ?? []).map((e) => ({
      id: e.id,
      type: e.type as TrackingEventEntry["type"],
      source: e.source as TrackingEventEntry["source"],
      customerVisible: e.customer_visible,
      customerMessage: e.customer_message,
      internalNote: e.internal_note,
      occurredAt: e.occurred_at,
      createdBy: e.created_by,
    })),
    mapPoints: points,
    hasGeo,
    latestPosition,
  };
}

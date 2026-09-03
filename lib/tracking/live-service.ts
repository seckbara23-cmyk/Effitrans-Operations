/**
 * TMS-2 — the Transport live map's read model. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Gate: `transport:read` — the authority that already governs every mission
 * surface. A DRIVER holds `tracking:read` but NOT `transport:read`, which is
 * precisely how §15 is enforced: the tracked driver cannot open the fleet-wide
 * map, while still seeing their own mission through the driver surface.
 *
 * The admin client bypasses RLS, so this app gate is the boundary (EC-3C) and
 * the tenant filter below is the rebuilt RLS predicate (MAYA-P0.8-C).
 *
 * NOTHING HERE IS FABRICATED. A mission with no session is absent, a session
 * with no position reports a null position, and the route is drawn only from
 * positions that were actually recorded. There is no interpolation and no
 * straight line between two fixes that were never observed as a path.
 */
import "server-only";
import { assertPermission } from "@/lib/auth/require-permission";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { classifyTrackingHealth } from "./health";
import { missionLeg, type TrackingSessionStatus } from "./types";
import type { LiveMission, LiveMissionPoint } from "./live-model";

export type { LiveMission, LiveMissionPoint, LiveTrackingKpis } from "./live-model";
export { summarizeLiveMissions } from "./live-model";

type SessionRow = {
  id: string;
  transport_id: string | null;
  file_id: string;
  status: string;
  last_position_at: string | null;
  return_started_at: string | null;
  ended_at: string | null;
};

/** Sessions still being followed: outbound, paused mid-leg, or on the way back. */
const OPEN_SESSION_STATUSES = ["ACTIVE", "PAUSED", "RETURNING"] as const;

/**
 * Every mission currently being tracked in the tenant, newest position first.
 * Returns [] for an unauthorized reader — the page then renders its empty
 * state rather than throwing.
 */
export async function listLiveMissions(nowIso?: string): Promise<LiveMission[]> {
  let user;
  try {
    user = await assertPermission("transport:read");
  } catch {
    return [];
  }
  const admin = getAdminSupabaseClient();
  const now = nowIso ? new Date(nowIso) : new Date();

  const { data: sessions } = await admin
    .from("tracking_session")
    .select("id, transport_id, file_id, status, last_position_at, return_started_at, ended_at")
    .eq("tenant_id", user.tenantId)
    .in("status", [...OPEN_SESSION_STATUSES])
    .returns<SessionRow[]>();
  const open = (sessions ?? []).filter((s) => s.transport_id);
  if (open.length === 0) return [];

  const transportIds = open.map((s) => s.transport_id as string);

  const [missionsRes, positionsRes] = await Promise.all([
    admin
      .from("transport_record")
      .select(
        "id, file_id, status, driver_name, vehicle_plate, pickup_location, delivery_location, return_location, return_latitude, return_longitude, vehicle:vehicle_id(registration), file:file_id(file_number), driver:driver_user_id(name)",
      )
      .eq("tenant_id", user.tenantId)
      .in("id", transportIds)
      .is("deleted_at", null),
    admin
      .from("tracking_position")
      .select("transport_id, latitude, longitude, recorded_at")
      .eq("tenant_id", user.tenantId)
      .in("transport_id", transportIds)
      .order("recorded_at", { ascending: false })
      .limit(500),
  ]);

  // Newest fix per mission — the ordered read above means the first seen wins.
  const latest = new Map<string, LiveMissionPoint>();
  for (const p of (positionsRes.data ?? []) as {
    transport_id: string | null; latitude: number; longitude: number; recorded_at: string;
  }[]) {
    if (!p.transport_id || latest.has(p.transport_id)) continue;
    latest.set(p.transport_id, { lat: Number(p.latitude), lng: Number(p.longitude), at: p.recorded_at });
  }

  const byId = new Map(
    ((missionsRes.data ?? []) as Record<string, unknown>[]).map((m) => [m.id as string, m]),
  );

  const out: LiveMission[] = [];
  for (const s of open) {
    const m = byId.get(s.transport_id as string);
    if (!m) continue; // deleted or cross-tenant: never invented
    const status = s.status as TrackingSessionStatus;
    const vehicle = m.vehicle as { registration?: string } | null;
    const file = m.file as { file_number?: string } | null;
    const driver = m.driver as { name?: string } | null;
    out.push({
      transportId: s.transport_id as string,
      fileId: s.file_id,
      fileNumber: file?.file_number ?? "—",
      vehicleLabel: vehicle?.registration ?? (m.vehicle_plate as string | null) ?? null,
      driverName: driver?.name ?? (m.driver_name as string | null) ?? null,
      transportStatus: m.status as string,
      sessionStatus: status,
      leg: missionLeg(status),
      health: classifyTrackingHealth({
        sessionStatus: status,
        lastPositionAt: s.last_position_at ?? latest.get(s.transport_id as string)?.at ?? null,
        now,
      }),
      lastPosition: latest.get(s.transport_id as string) ?? null,
      pickupLocation: (m.pickup_location as string | null) ?? null,
      deliveryLocation: (m.delivery_location as string | null) ?? null,
      returnLocation: (m.return_location as string | null) ?? null,
      returnPoint:
        m.return_latitude != null && m.return_longitude != null
          ? { lat: Number(m.return_latitude), lng: Number(m.return_longitude) }
          : null,
      returnStartedAt: s.return_started_at ?? null,
    });
  }
  return out;
}


/** Sessions completed since midnight (tenant time is out of scope: UTC day). */
export async function countSessionsEndedToday(): Promise<number> {
  let user;
  try {
    user = await assertPermission("transport:read");
  } catch {
    return 0;
  }
  const admin = getAdminSupabaseClient();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("tracking_session")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("status", "COMPLETED")
    .gte("ended_at", since.toISOString());
  return count ?? 0;
}

/**
 * The observed route for one mission, oldest first — ONLY recorded positions.
 * The map draws a polyline through these and nothing else: no snapping to
 * roads, no interpolation, no inferred path between distant fixes.
 */
export async function getObservedRoute(transportId: string, limit = 500): Promise<LiveMissionPoint[]> {
  let user;
  try {
    user = await assertPermission("transport:read");
  } catch {
    return [];
  }
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("tracking_position")
    .select("latitude, longitude, recorded_at")
    .eq("tenant_id", user.tenantId)
    .eq("transport_id", transportId)
    .order("recorded_at", { ascending: true })
    .limit(limit)
    .returns<{ latitude: number; longitude: number; recorded_at: string }[]>();
  return (data ?? []).map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude), at: p.recorded_at }));
}

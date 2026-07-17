/**
 * Executive — aggregate fleet map reader (Phase 7.7). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ONE aggregate map over the whole organization: ships, aircraft, road deliveries, ports and
 * airports. It builds NO mapping engine and NO position logic — it reuses the existing tracking
 * model wholesale:
 *   - freshness  → classifyFreshness() (lib/shipping/intelligence/freshness), the SAME thresholds
 *                  per source the shipping/air maps already use;
 *   - confidence + source → carried through VERBATIM from the tracking event row (CONFIRMED /
 *                  INFERRED / MANUAL / ESTIMATED · CARRIER / AIS / ROAD / …). Never recomputed.
 *   - bounds     → markerBounds() over real markers only (lib/executive/compose).
 *
 * NEVER A FULL TRACKING SCAN (the phase's hard performance rule). Each mode issues exactly ONE
 * bounded, indexed, newest-first query capped at EVENT_SCAN rows; the latest located event per
 * shipment is then picked IN MEMORY. So the cost is O(EVENT_SCAN) rows per mode regardless of how
 * much history the tenant has, and there is no per-shipment query (no N+1). Truncation is
 * disclosed via `capped`, never silent.
 *
 * HONEST GAPS (documented, not faked): there is no warehouse table and no customs-office table
 * carrying coordinates, so those marker kinds from the brief cannot be sourced and are omitted
 * rather than invented. Port/airport coordinates are nullable and deliberately UNSEEDED upstream
 * ("no invented coordinates"), so only rows that actually carry a position are plotted.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { classifyFreshness, isStaleFreshness, type Freshness } from "@/lib/shipping/intelligence/freshness";
import type { TrackingSource } from "@/lib/shipping/intelligence/events";
import { markerBounds } from "../compose";
import type { ExecutiveMap, ExecutiveMapMarker } from "../types";

/** Newest-first rows examined per mode. Bounds the query; the map itself is capped below. */
const EVENT_SCAN = 400;
/** Maximum markers of each moving kind actually plotted. */
const MOVER_CAP = 60;
/** Maximum static (port/airport) markers plotted. */
const PLACE_CAP = 40;

type EventRow = {
  shipment_id: string;
  occurred_at: string;
  source: string;
  confidence: string;
  event_type: string;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
};
type OceanRow = EventRow & { vessel_name: string | null };
type AirRow = EventRow & { flight_number: string | null };
type ShipmentRow = { id: string; file_id: string; file: { file_number: string | null; client: { name: string | null } | null } | null };

/** Keep the newest located event per shipment. Input MUST already be newest-first. */
function latestPerShipment<T extends { shipment_id: string }>(rows: T[], cap: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.shipment_id)) continue;
    seen.add(r.shipment_id);
    out.push(r);
    if (out.length >= cap) break;
  }
  return out;
}

const freshnessOf = (source: string, at: string, nowIso: string): Freshness =>
  classifyFreshness((source as TrackingSource) ?? "SYSTEM", at, nowIso);

export async function readFleetMap(): Promise<ExecutiveMap> {
  const user = await assertPermission("executive:dashboard:read");
  const perms = await getEffectivePermissions(user.id);
  const canTransport = hasPermission(perms, "transport:read");
  const admin = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const nowIso = new Date().toISOString();

  // Positions are transport data — an executive without transport:read gets no fleet map rather
  // than a partial one (Missing ≠ Negative; the section reports itself unavailable).
  if (!canTransport) {
    return { markers: [], bounds: null, capped: false, cap: MOVER_CAP, warnings: ["transport:read requis pour la carte agrégée."] };
  }

  const [oceanRes, airRes, roadRes, portsRes, airportsRes] = await Promise.all([
    admin.from("ocean_tracking_event")
      .select("shipment_id, occurred_at, source, confidence, event_type, location_name, latitude, longitude, vessel_name")
      .eq("tenant_id", tenant).not("latitude", "is", null).not("longitude", "is", null)
      .order("occurred_at", { ascending: false }).limit(EVENT_SCAN).returns<OceanRow[]>(),
    admin.from("air_tracking_event")
      .select("shipment_id, occurred_at, source, confidence, event_type, location_name, latitude, longitude, flight_number")
      .eq("tenant_id", tenant).not("latitude", "is", null).not("longitude", "is", null)
      .order("occurred_at", { ascending: false }).limit(EVENT_SCAN).returns<AirRow[]>(),
    admin.from("tracking_position")
      .select("file_id, latitude, longitude, recorded_at, source")
      .eq("tenant_id", tenant)
      .order("recorded_at", { ascending: false }).limit(EVENT_SCAN)
      .returns<{ file_id: string; latitude: number; longitude: number; recorded_at: string; source: string }[]>(),
    // 8.4 fix: ocean_port has NO `active` column (air_airport does) — the filter made this
    // query error and silently drop every port marker into the catch.
    admin.from("ocean_port").select("name, unlocode, latitude, longitude")
      .eq("tenant_id", tenant).not("latitude", "is", null).not("longitude", "is", null)
      .limit(PLACE_CAP).returns<{ name: string; unlocode: string | null; latitude: number; longitude: number }[]>(),
    admin.from("air_airport").select("name, iata, latitude, longitude")
      .eq("tenant_id", tenant).eq("active", true).not("latitude", "is", null).not("longitude", "is", null)
      .limit(PLACE_CAP).returns<{ name: string; iata: string | null; latitude: number; longitude: number }[]>(),
  ]);

  const oceanLatest = latestPerShipment(oceanRes.data ?? [], MOVER_CAP);
  const airLatest = latestPerShipment(airRes.data ?? [], MOVER_CAP);

  // Road: latest position per FILE (tracking_position is file-scoped, not shipment-scoped).
  const roadSeen = new Set<string>();
  const roadLatest = (roadRes.data ?? []).filter((r) => {
    if (roadSeen.has(r.file_id)) return false;
    roadSeen.add(r.file_id);
    return roadSeen.size <= MOVER_CAP;
  });

  // ONE batched lookup resolving every plotted shipment to its dossier label (no N+1).
  const shipmentIds = [...oceanLatest.map((r) => r.shipment_id), ...airLatest.map((r) => r.shipment_id)];
  const shipById = new Map<string, ShipmentRow>();
  if (shipmentIds.length) {
    const { data } = await admin.from("shipment")
      .select("id, file_id, file:file_id(file_number, client:client_id(name))")
      .eq("tenant_id", tenant).in("id", shipmentIds).returns<ShipmentRow[]>();
    for (const s of data ?? []) shipById.set(s.id, s);
  }
  const roadFileIds = roadLatest.map((r) => r.file_id);
  const fileById = new Map<string, { file_number: string | null; client: { name: string | null } | null }>();
  if (roadFileIds.length) {
    const { data } = await admin.from("operational_file")
      .select("id, file_number, client:client_id(name)")
      .eq("tenant_id", tenant).in("id", roadFileIds)
      .returns<{ id: string; file_number: string | null; client: { name: string | null } | null }[]>();
    for (const f of data ?? []) fileById.set(f.id, { file_number: f.file_number, client: f.client });
  }

  const warnings: string[] = [];
  const markers: ExecutiveMapMarker[] = [];

  for (const e of oceanLatest) {
    const s = shipById.get(e.shipment_id);
    const f = freshnessOf(e.source, e.occurred_at, nowIso);
    if (isStaleFreshness(f)) warnings.push(`Position maritime obsolète : ${s?.file?.file_number ?? e.shipment_id.slice(0, 8)}`);
    markers.push({
      kind: "ship",
      label: e.vessel_name ?? s?.file?.file_number ?? "Navire",
      latitude: e.latitude as number, longitude: e.longitude as number,
      status: e.event_type, freshness: f, confidence: e.confidence, source: e.source,
      occurredAt: e.occurred_at,
      reference: s?.file?.file_number ?? null,
      href: `/shipping/shipments/${e.shipment_id}`,
    });
  }

  for (const e of airLatest) {
    const s = shipById.get(e.shipment_id);
    const f = freshnessOf(e.source, e.occurred_at, nowIso);
    if (isStaleFreshness(f)) warnings.push(`Position aérienne obsolète : ${s?.file?.file_number ?? e.shipment_id.slice(0, 8)}`);
    markers.push({
      kind: "aircraft",
      label: e.flight_number ?? s?.file?.file_number ?? "Vol",
      latitude: e.latitude as number, longitude: e.longitude as number,
      status: e.event_type, freshness: f, confidence: e.confidence, source: e.source,
      occurredAt: e.occurred_at,
      reference: s?.file?.file_number ?? null,
      href: `/air/shipments/${e.shipment_id}`,
    });
  }

  for (const r of roadLatest) {
    const f = fileById.get(r.file_id);
    // tracking_position.source is the road vocabulary ('driver_mobile'/'vehicle_gps'/…); the
    // freshness engine keys on the shared TrackingSource, so road fixes classify as ROAD.
    const fr = freshnessOf("ROAD", r.recorded_at, nowIso);
    markers.push({
      kind: "road",
      label: f?.file_number ?? "Livraison",
      latitude: r.latitude, longitude: r.longitude,
      status: null, freshness: fr, confidence: null, source: r.source,
      occurredAt: r.recorded_at,
      reference: f?.file_number ?? null,
      href: `/files/${r.file_id}`,
    });
  }

  for (const p of portsRes.data ?? []) {
    markers.push({ kind: "port", label: p.name, latitude: p.latitude, longitude: p.longitude, status: null, freshness: null, confidence: null, source: null, occurredAt: null, reference: p.unlocode, href: "/shipping/ports" });
  }
  for (const a of airportsRes.data ?? []) {
    markers.push({ kind: "airport", label: a.name, latitude: a.latitude, longitude: a.longitude, status: null, freshness: null, confidence: null, source: null, occurredAt: null, reference: a.iata, href: "/air/airports" });
  }

  const capped =
    (oceanRes.data?.length ?? 0) >= EVENT_SCAN ||
    (airRes.data?.length ?? 0) >= EVENT_SCAN ||
    (roadRes.data?.length ?? 0) >= EVENT_SCAN ||
    oceanLatest.length >= MOVER_CAP || airLatest.length >= MOVER_CAP || roadLatest.length >= MOVER_CAP;

  return {
    markers,
    bounds: markerBounds(markers),
    capped,
    cap: MOVER_CAP,
    warnings: warnings.slice(0, 8),
  };
}

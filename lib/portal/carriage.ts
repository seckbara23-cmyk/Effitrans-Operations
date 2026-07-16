/**
 * Customer-safe ocean/air carriage view (Phase 7.5A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Surfaces the vessel/flight, container/ULD list, safe references (BL/AWB), and an interactive
 * MAP for a portal dossier's international shipment. Ownership is enforced by the RLS user-context
 * client (the shipment + its ocean/air child rows are readable only via the Phase 7.5A portal
 * policies, scoped tenant + customer + portal-account). It REUSES the shared, provider-neutral
 * map + position engines (buildShipmentMapProjection / resolveCurrentPosition / resolveAirPosition)
 * — no second map logic. Only customer-safe fields are projected: no internal IDs, provider refs,
 * staff identity, confidence internals beyond the marker's own source/confidence/freshness.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentPortalUser } from "./auth";
import { resolveCurrentPosition, type ResolvedPosition } from "@/lib/shipping/intelligence/position";
import { resolveAirPosition } from "@/lib/air/intelligence/position";
import { milestoneLabel, type ShippingMilestone } from "@/lib/shipping/intelligence/milestones";
import { airMilestoneLabel, type AirMilestone } from "@/lib/air/intelligence/milestones";
import { buildShipmentMapProjection, type ShipmentMapProjection, type MilestoneMarkerInput } from "@/lib/shipping/intelligence/map-projection";

export type CarriageUnit = { label: string; type: string | null; status: string };
export type CarriageReference = { label: string; value: string };

export type PortalCarriage = {
  mode: "SEA" | "AIR";
  transportLabel: string;
  carrierOrVessel: string | null;
  voyageOrFlight: string | null;
  milestoneLabel: string | null;
  references: CarriageReference[];
  units: { heading: string; items: CarriageUnit[] };
  map: ShipmentMapProjection;
  hasGeo: boolean;
};

type ShipmentRow = {
  id: string;
  transport_mode: string;
  origin: string | null;
  destination: string | null;
  ocean_milestone: string | null;
  air_milestone: string | null;
  master_bl: string | null;
  house_bl: string | null;
  booking_reference: string | null;
};
type OceanEvent = { event_type: string; occurred_at: string; source: string | null; confidence: string | null; location_name: string | null; location_unlocode: string | null; latitude: number | null; longitude: number | null; vessel_name: string | null; voyage_reference: string | null };
type AirEvent = { event_type: string; occurred_at: string; confidence: string | null; location_name: string | null; location_iata: string | null; latitude: number | null; longitude: number | null; flight_number: string | null };

const OCEAN_MODES = ["SEA", "MULTIMODAL"];
const ref = (label: string, value: string | null): CarriageReference[] => (value ? [{ label, value }] : []);
const hasCoords = (m: ShipmentMapProjection): boolean => !!m.bounds;

export async function getPortalCarriage(fileId: string): Promise<PortalCarriage | null> {
  const user = await getCurrentPortalUser();
  if (!user) return null;

  // Ownership boundary: RLS restricts this to the caller's own client's shipment.
  const ctx = getServerSupabaseClient();
  const { data: ship } = await ctx
    .from("shipment")
    .select("id, transport_mode, origin, destination, ocean_milestone, air_milestone, master_bl, house_bl, booking_reference")
    .eq("file_id", fileId)
    .maybeSingle<ShipmentRow>();
  if (!ship) return null; // road-only / no international shipment ⇒ no carriage view

  const now = new Date().toISOString();
  const mode = OCEAN_MODES.includes(ship.transport_mode) ? "SEA" : ship.transport_mode === "AIR" ? "AIR" : null;
  if (!mode) return null;

  if (mode === "SEA") return oceanCarriage(ctx, ship, fileId, now);
  return airCarriage(ctx, ship, now, user.tenantId);
}

async function oceanCarriage(ctx: ReturnType<typeof getServerSupabaseClient>, ship: ShipmentRow, fileId: string, now: string): Promise<PortalCarriage> {
  const [containersRes, eventsRes, posRes] = await Promise.all([
    ctx.from("ocean_container").select("container_number, iso_type, status").eq("shipment_id", ship.id).order("container_number", { ascending: true }).returns<{ container_number: string; iso_type: string | null; status: string }[]>(),
    ctx.from("ocean_tracking_event").select("event_type, occurred_at, source, confidence, location_name, location_unlocode, latitude, longitude, vessel_name, voyage_reference").eq("shipment_id", ship.id).order("occurred_at", { ascending: false }).limit(200).returns<OceanEvent[]>(),
    // Road GPS fix is portal-visible only when the operator marked it customer_visible.
    ctx.from("tracking_position").select("latitude, longitude, recorded_at").eq("file_id", fileId).order("recorded_at", { ascending: false }).limit(1).maybeSingle<{ latitude: number; longitude: number; recorded_at: string }>(),
  ]);
  const events = eventsRes.data ?? [];
  const geoEvents = events.filter((e) => e.latitude != null && e.longitude != null);
  const anchor = geoEvents[0] ?? null; // most recent located event
  const road = posRes.data;

  const position: ResolvedPosition = resolveCurrentPosition({
    roadFix: road ? { latitude: road.latitude, longitude: road.longitude, occurredAt: road.recorded_at } : null,
    containerConfirmedOnVessel: false,
    vesselPosition: null,
    portAnchor: anchor
      ? { name: anchor.location_name ?? anchor.location_unlocode ?? milestoneLabel(anchor.event_type as ShippingMilestone), latitude: anchor.latitude, longitude: anchor.longitude, occurredAt: anchor.occurred_at, confirmed: anchor.confidence === "CONFIRMED" }
      : null,
  }, now);

  const milestoneMarkers: MilestoneMarkerInput[] = geoEvents.map((e) => ({ milestone: e.event_type as ShippingMilestone, latitude: e.latitude, longitude: e.longitude, occurredAt: e.occurred_at }));
  const map = buildShipmentMapProjection({ current: position, milestoneMarkers });
  const vesselEvent = events.find((e) => e.vessel_name);

  return {
    mode: "SEA",
    transportLabel: "Transport maritime",
    carrierOrVessel: vesselEvent?.vessel_name ?? null,
    voyageOrFlight: vesselEvent?.voyage_reference ?? null,
    milestoneLabel: ship.ocean_milestone ? milestoneLabel(ship.ocean_milestone as ShippingMilestone) : null,
    references: [...ref("Connaissement (MBL)", ship.master_bl), ...ref("Connaissement maison (HBL)", ship.house_bl), ...ref("Réservation", ship.booking_reference)],
    units: { heading: "Conteneurs", items: (containersRes.data ?? []).map((c) => ({ label: c.container_number, type: c.iso_type, status: c.status })) },
    map,
    hasGeo: hasCoords(map),
  };
}

async function airCarriage(ctx: ReturnType<typeof getServerSupabaseClient>, ship: ShipmentRow, now: string, tenantId: string): Promise<PortalCarriage> {
  const [awbRes, uldsRes, eventsRes] = await Promise.all([
    ctx.from("air_awb").select("mawb, hawb, flight_id").eq("shipment_id", ship.id).maybeSingle<{ mawb: string | null; hawb: string | null; flight_id: string | null }>(),
    ctx.from("air_uld").select("uld_number, uld_type, status").eq("shipment_id", ship.id).order("uld_number", { ascending: true }).returns<{ uld_number: string; uld_type: string | null; status: string }[]>(),
    ctx.from("air_tracking_event").select("event_type, occurred_at, confidence, location_name, location_iata, latitude, longitude, flight_number").eq("shipment_id", ship.id).order("occurred_at", { ascending: false }).limit(200).returns<AirEvent[]>(),
  ]);
  const awb = awbRes.data;
  const events = eventsRes.data ?? [];
  const geoEvents = events.filter((e) => e.latitude != null && e.longitude != null);
  const anchor = geoEvents[0] ?? null;

  // Origin/destination airport coordinates need the flight/airport catalog (staff-RLS). Ownership
  // is already proven above (the AWB was read via the portal RLS client), so a bounded service-role
  // lookup of the OWNED shipment's flight is safe and does not expose the catalog to the portal.
  let flight: { flightNumber: string | null; origin: { latitude: number; longitude: number; label?: string } | null; destination: { latitude: number; longitude: number; label?: string } | null } | null = null;
  if (awb?.flight_id) flight = await lookupFlight(awb.flight_id, tenantId);

  const position: ResolvedPosition = resolveAirPosition({
    airportAnchor: anchor
      ? { name: anchor.location_name ?? anchor.location_iata ?? airMilestoneLabel(anchor.event_type as AirMilestone), latitude: anchor.latitude, longitude: anchor.longitude, occurredAt: anchor.occurred_at, confirmed: anchor.confidence === "CONFIRMED" }
      : null,
    cargoConfirmedOnFlight: false,
    flightPosition: null,
    manualFix: null,
  }, now);

  const milestoneMarkers: MilestoneMarkerInput[] = geoEvents.map((e) => ({ milestone: "IN_TRANSIT" as never, latitude: e.latitude, longitude: e.longitude, occurredAt: e.occurred_at, label: airMilestoneLabel(e.event_type as AirMilestone) }));
  const map = buildShipmentMapProjection({ origin: flight?.origin ?? null, destination: flight?.destination ?? null, current: position, milestoneMarkers });
  const flightNumber = flight?.flightNumber ?? events.find((e) => e.flight_number)?.flight_number ?? null;

  return {
    mode: "AIR",
    transportLabel: "Fret aérien",
    carrierOrVessel: flightNumber,
    voyageOrFlight: null,
    milestoneLabel: ship.air_milestone ? airMilestoneLabel(ship.air_milestone as AirMilestone) : null,
    references: [...ref("LTA maîtresse (MAWB)", awb?.mawb ?? null), ...ref("LTA maison (HAWB)", awb?.hawb ?? null)],
    units: { heading: "ULD", items: (uldsRes.data ?? []).map((u) => ({ label: u.uld_number, type: u.uld_type, status: u.status })) },
    map,
    hasGeo: hasCoords(map),
  };
}

/** Bounded service-role lookup of the OWNED shipment's flight endpoints (never exposes the catalog). */
async function lookupFlight(flightId: string, tenantId: string) {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("air_flight")
    .select("flight_number, origin:origin_airport_id(name, latitude, longitude), dest:destination_airport_id(name, latitude, longitude)")
    .eq("id", flightId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ flight_number: string | null; origin: { name: string; latitude: number | null; longitude: number | null } | null; dest: { name: string; latitude: number | null; longitude: number | null } | null }>();
  if (!data) return null;
  const pt = (a: { name: string; latitude: number | null; longitude: number | null } | null) => (a && a.latitude != null && a.longitude != null ? { latitude: a.latitude, longitude: a.longitude, label: a.name } : null);
  return { flightNumber: data.flight_number, origin: pt(data.origin), destination: pt(data.dest) };
}

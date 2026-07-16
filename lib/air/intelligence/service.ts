/**
 * Air Cargo — console reads (Phase 7.3A). SERVER-ONLY. Admin client gated by transport:read;
 * every tenant-scoped read is tenant-filtered (leak guard). SQL-paginated. Reuses the shared
 * map projection, freshness, customs summary, and ETA-change engines. No provider call on reads.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { buildAirDashboard, type AirDashboard, type AirDashboardRow } from "./dashboard";
import { AIR_SHIPMENT_COLS, rowToAirShipment, coerceAirMilestone, type AirShipmentRow } from "./persistence";
import { rowToAirEvent, latestAirMilestoneEvent, sortEvents, airEventIsMilestone, type AirEventRow, type AirTrackingEvent } from "./events";
import { resolveAirProviderConfig, AIR_PROVIDERS, type AirProviderConfig } from "./provider";
import { resolveAirPosition } from "./position";
import { airMilestoneLabel, type AirMilestone } from "./milestones";
import type { AirShipment, ULD } from "./domain";
import { classifyFreshness } from "@/lib/shipping/intelligence/freshness";
import { detectEtaChange } from "@/lib/shipping/intelligence/eta";
import { buildShipmentMapProjection, type ShipmentMapProjection } from "@/lib/shipping/intelligence/map-projection";
import { getShipmentCustomsSummary, type ShipmentCustomsSummary } from "@/lib/shipping/intelligence/customs-link";
import type { ResolvedPosition } from "@/lib/shipping/intelligence/position";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
export const DASHBOARD_CAP = 2000;
export const PAGE_SIZE = 25;
const MAX_PAGE = 100;
const TIMELINE_CAP = 200;

async function gate() { const u = await assertPermission("transport:read"); return { admin: getAdminSupabaseClient(), tenantId: u.tenantId }; }
function bounds(page: number, size = PAGE_SIZE) { const s = Math.min(Math.max(1, size), MAX_PAGE); return { s, from: Math.max(0, page) * s }; }
function nowIso() { return new Date().toISOString(); }

// ---------------------------------------------------------------- dashboard ----
export type AirDashboardResult = { dashboard: AirDashboard; providers: AirProviderConfig[]; capped: boolean; cap: number };
export async function getAirDashboard(): Promise<AirDashboardResult> {
  const { admin, tenantId } = await gate();
  const providers = AIR_PROVIDERS.map((p) => resolveAirProviderConfig(p));
  const now = nowIso();
  const { data, error } = await admin.from("shipment")
    .select("air_milestone, etd, atd, eta, ata, eta_previous, tracking_synced_at")
    .eq("tenant_id", tenantId).eq("transport_mode", "AIR")
    .order("updated_at", { ascending: false }).range(0, DASHBOARD_CAP)
    .returns<{ air_milestone: string; etd: string | null; atd: string | null; eta: string | null; ata: string | null; eta_previous: string | null; tracking_synced_at: string | null }[]>();
  if (error) throw new Error(`[air] dashboard failed: ${error.message}`);
  const rows = data ?? [];
  const capped = rows.length > DASHBOARD_CAP;
  const working = capped ? rows.slice(0, DASHBOARD_CAP) : rows;
  const dRows: AirDashboardRow[] = working.map((r) => ({
    milestone: coerceAirMilestone(r.air_milestone), scheduledDeparture: r.etd, actualDeparture: r.atd,
    scheduledArrival: r.eta_previous, actualArrival: r.ata, plannedArrival: r.eta_previous, estimatedArrival: r.eta,
    freshness: classifyFreshness("CARRIER", r.tracking_synced_at, now), significantEtaChange: detectEtaChange(r.eta_previous, r.eta).significant,
  }));
  return { dashboard: buildAirDashboard(dRows, now), providers, capped, cap: DASHBOARD_CAP };
}

// ---------------------------------------------------------------- list ----
export type AirListItem = { id: string; fileId: string; fileNumber: string | null; clientName: string | null; mawb: string | null; origin: string | null; destination: string | null; milestone: AirMilestone; milestoneLabel: string; estimatedArrival: string | null };
export type AirFilters = { search?: string; milestone?: string };
export async function listAirShipments(filters: AirFilters = {}, page = 0): Promise<{ items: AirListItem[]; page: number; hasMore: boolean }> {
  const { admin, tenantId } = await gate();
  const { s, from } = bounds(page);
  let q = admin.from("shipment").select(`${AIR_SHIPMENT_COLS}, file:file_id(file_number, client:client_id(name)), awb:air_awb(mawb, hawb)`).eq("tenant_id", tenantId).eq("transport_mode", "AIR");
  if (filters.milestone) q = q.eq("air_milestone", filters.milestone);
  if (filters.search?.trim()) { const t = filters.search.trim().replace(/[^a-zA-Z0-9\- ]/g, "").trim(); if (t) q = q.or(`origin.ilike.*${t}*,destination.ilike.*${t}*`); }
  const { data, error } = await q.order("updated_at", { ascending: false }).order("id", { ascending: false }).range(from, from + s)
    .returns<(AirShipmentRow & { file: { file_number: string; client: { name: string } | null } | null; awb: { mawb: string | null; hawb: string | null }[] | null })[]>();
  if (error) throw new Error(`[air] list failed: ${error.message}`);
  const rows = data ?? [];
  const items = rows.slice(0, s).map((r) => {
    const awb = r.awb?.[0] ?? null;
    const sh = rowToAirShipment(r, { fileNumber: r.file?.file_number ?? null, clientName: r.file?.client?.name ?? null, mawb: awb?.mawb ?? null, hawb: awb?.hawb ?? null });
    return { id: sh.id, fileId: sh.fileId, fileNumber: sh.fileNumber, clientName: sh.clientName, mawb: sh.mawb, origin: sh.origin, destination: sh.destination, milestone: sh.milestone, milestoneLabel: airMilestoneLabel(sh.milestone), estimatedArrival: sh.estimatedArrival };
  });
  return { items, page: Math.max(0, page), hasMore: rows.length > s };
}

// ---------------------------------------------------------------- detail ----
export type AirShipmentDetail = { shipment: AirShipment; version: number; ulds: ULD[]; timeline: AirTrackingEvent[]; position: ResolvedPosition; map: ShipmentMapProjection; customs: ShipmentCustomsSummary; provider: AirProviderConfig; nextMilestones: AirMilestone[]; flightNumber: string | null };
export async function getAirShipmentDetail(id: string): Promise<AirShipmentDetail | null> {
  const { admin, tenantId } = await gate();
  const now = nowIso();
  const { data, error } = await admin.from("shipment")
    .select(`${AIR_SHIPMENT_COLS}, file:file_id(file_number, client:client_id(name)), awb:air_awb(mawb, hawb, flight_id)`)
    .eq("id", id).eq("tenant_id", tenantId).eq("transport_mode", "AIR")
    .maybeSingle<AirShipmentRow & { file: { file_number: string; client: { name: string } | null } | null; awb: { mawb: string | null; hawb: string | null; flight_id: string | null }[] | null }>();
  if (error) throw new Error(`[air] detail failed: ${error.message}`);
  if (!data) return null;
  const awb = data.awb?.[0] ?? null;

  const [ulds, events, customs, flight] = await Promise.all([
    readUlds(admin, tenantId, id),
    readEvents(admin, tenantId, id),
    getShipmentCustomsSummary(admin, tenantId, data.file_id),
    awb?.flight_id ? readFlightMap(admin, tenantId, awb.flight_id) : Promise.resolve(null),
  ]);

  const last = latestAirMilestoneEvent(events);
  const position = resolveAirPosition({
    airportAnchor: last?.location ? { name: last.location.name ?? last.location.iata ?? airMilestoneLabel(last.eventType as AirMilestone), latitude: last.location.latitude ?? null, longitude: last.location.longitude ?? null, occurredAt: last.occurredAt, confirmed: last.confidence === "CONFIRMED" } : null,
    cargoConfirmedOnFlight: false, flightPosition: null, manualFix: null,
  }, now);

  const milestoneMarkers = events.filter((e) => airEventIsMilestone(e.eventType) && e.location?.latitude != null && e.location?.longitude != null)
    .map((e) => ({ milestone: "IN_TRANSIT" as never, latitude: e.location!.latitude ?? null, longitude: e.location!.longitude ?? null, occurredAt: e.occurredAt, label: airMilestoneLabel(e.eventType as AirMilestone) }));
  const map = buildShipmentMapProjection({ origin: flight?.origin ?? null, destination: flight?.destination ?? null, current: position, milestoneMarkers });

  const shipment = rowToAirShipment(data, { fileNumber: data.file?.file_number ?? null, clientName: data.file?.client?.name ?? null, mawb: awb?.mawb ?? null, hawb: awb?.hawb ?? null, positionConfidence: position.available ? position.confidence : null });
  return { shipment, version: data.air_tracking_version, ulds, timeline: sortEvents(events), position, map, customs, provider: resolveAirProviderConfig(shipment.providerCode), nextMilestones: nextAirMilestones(shipment.milestone), flightNumber: flight?.flightNumber ?? null };
}

async function readUlds(admin: Admin, tenantId: string, shipmentId: string): Promise<ULD[]> {
  const { data } = await admin.from("air_uld").select("id, shipment_id, flight_id, uld_number, uld_type, owner, status").eq("tenant_id", tenantId).eq("shipment_id", shipmentId).order("uld_number").returns<{ id: string; shipment_id: string; flight_id: string | null; uld_number: string; uld_type: string | null; owner: string | null; status: string }[]>();
  return (data ?? []).map((u) => ({ id: u.id, shipmentId: u.shipment_id, flightId: u.flight_id, number: u.uld_number, type: u.uld_type, owner: u.owner, status: u.status as ULD["status"] }));
}
async function readEvents(admin: Admin, tenantId: string, shipmentId: string): Promise<AirTrackingEvent[]> {
  const { data } = await admin.from("air_tracking_event").select("id, tenant_id, shipment_id, uld_id, event_type, occurred_at, received_at, source, provider_code, confidence, location_name, location_iata, latitude, longitude, flight_number, description, fingerprint").eq("tenant_id", tenantId).eq("shipment_id", shipmentId).order("occurred_at", { ascending: false }).limit(TIMELINE_CAP).returns<AirEventRow[]>();
  return (data ?? []).map(rowToAirEvent);
}
async function readFlightMap(admin: Admin, tenantId: string, flightId: string): Promise<{ flightNumber: string | null; origin: { latitude: number; longitude: number; label?: string } | null; destination: { latitude: number; longitude: number; label?: string } | null } | null> {
  const { data } = await admin.from("air_flight").select("flight_number, origin:origin_airport_id(name, latitude, longitude), dest:destination_airport_id(name, latitude, longitude)").eq("id", flightId).eq("tenant_id", tenantId).maybeSingle<{ flight_number: string | null; origin: { name: string; latitude: number | null; longitude: number | null } | null; dest: { name: string; latitude: number | null; longitude: number | null } | null }>();
  if (!data) return null;
  const pt = (a: { name: string; latitude: number | null; longitude: number | null } | null) => (a && a.latitude != null && a.longitude != null ? { latitude: a.latitude, longitude: a.longitude, label: a.name } : null);
  return { flightNumber: data.flight_number, origin: pt(data.origin), destination: pt(data.dest) };
}

function nextAirMilestones(current: AirMilestone): AirMilestone[] {
  const order: AirMilestone[] = ["BOOKED", "ACCEPTED", "SECURITY", "READY_FOR_FLIGHT", "LOADED", "DEPARTED", "TRANSFER", "ARRIVED", "CUSTOMS", "RELEASED", "DELIVERED"];
  const i = order.indexOf(current);
  return [...(i >= 0 ? order.slice(i + 1, i + 4) : []), "EXCEPTION", "CANCELLED"] as AirMilestone[];
}

// ---------------------------------------------------------------- ULD list ----
export async function listUldsAll(page = 0): Promise<{ items: { id: string; number: string; type: string | null; status: string; shipmentId: string; fileNumber: string | null }[]; page: number; hasMore: boolean }> {
  const { admin, tenantId } = await gate();
  const { s, from } = bounds(page);
  const { data, error } = await admin.from("air_uld").select("id, uld_number, uld_type, status, shipment_id, shipment:shipment_id(file:file_id(file_number))").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).range(from, from + s).returns<{ id: string; uld_number: string; uld_type: string | null; status: string; shipment_id: string; shipment: { file: { file_number: string } | null } | null }[]>();
  if (error) throw new Error(`[air] uld list failed: ${error.message}`);
  const rows = data ?? [];
  return { items: rows.slice(0, s).map((u) => ({ id: u.id, number: u.uld_number, type: u.uld_type, status: u.status, shipmentId: u.shipment_id, fileNumber: u.shipment?.file?.file_number ?? null })), page: Math.max(0, page), hasMore: rows.length > s };
}

/**
 * Shipping Line Platform — console reads (Phase 7.2A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Service-role admin client, gated by assertPermission('transport:read'). Every
 * tenant-scoped read is tenant-filtered (leak guard enforced). Dashboard aggregates reuse
 * the pure 7.2A contracts over a BOUNDED working set (cap disclosed). Lists paginate in
 * SQL. NO provider network call happens on any read path. Ocean = shipment rows with a
 * maritime transport mode.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { buildShippingDashboard, type ShippingDashboard, type DashboardShipmentRow } from "./dashboard";
import { OCEAN_SHIPMENT_COLS, rowToOceanShipment, rowToContainer, rowToEvent, coerceMilestone, type ShipmentRow, type ContainerRow, type EventRow } from "./persistence";
import { classifyFreshness } from "./freshness";
import { detectEtaChange } from "./eta";
import { resolveShippingProviderConfig, resolveAisConfig, type ShippingProviderConfig } from "./config";
import { SHIPPING_PROVIDERS } from "./provider";
import { resolveCurrentPosition, type ResolvedPosition } from "./position";
import { buildShipmentMapProjection, type ShipmentMapProjection } from "./map-projection";
import { sortEvents, latestMilestoneEvent, eventIsMilestone } from "./events";
import { milestoneLabel, type ShippingMilestone } from "./milestones";
import { getShipmentCustomsSummary, type ShipmentCustomsSummary } from "./customs-link";
import type { OceanShipment, Container } from "./domain";
import type { ShippingTrackingEvent } from "./events";

const OCEAN_MODES = ["SEA", "MULTIMODAL"];
export const DASHBOARD_CAP = 2000;
export const LIST_PAGE_SIZE = 25;
const MAX_PAGE = 100;
const TIMELINE_CAP = 200;

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type FileJoin = { file: { file_number: string; client: { name: string } | null } | null };

async function gate(): Promise<{ admin: Admin; tenantId: string; userId: string }> {
  const user = await assertPermission("transport:read");
  return { admin: getAdminSupabaseClient(), tenantId: user.tenantId, userId: user.id };
}

function nowIso(): string {
  return new Date().toISOString();
}

// ------------------------------------------------------------------- dashboard ----

export type ShippingDashboardResult = {
  dashboard: ShippingDashboard;
  providers: ShippingProviderConfig[];
  ais: ShippingProviderConfig;
  capped: boolean;
  cap: number;
};

export async function getShippingDashboard(): Promise<ShippingDashboardResult> {
  const { admin, tenantId } = await gate();
  const providers = SHIPPING_PROVIDERS.map((p) => resolveShippingProviderConfig(p));
  const ais = resolveAisConfig();
  const now = nowIso();

  const { data, error } = await admin
    .from("shipment")
    .select("id, tracking_synced_at, provider_code, ocean_milestone, booking_status, eta, eta_previous, etd, atd")
    .eq("tenant_id", tenantId)
    .in("transport_mode", OCEAN_MODES)
    .order("updated_at", { ascending: false })
    .range(0, DASHBOARD_CAP)
    .returns<{ id: string; tracking_synced_at: string | null; provider_code: string; ocean_milestone: string; booking_status: string | null; eta: string | null; eta_previous: string | null; etd: string | null; atd: string | null }[]>();
  if (error) throw new Error(`[shipping] dashboard read failed: ${error.message}`);

  const rows = data ?? [];
  const capped = rows.length > DASHBOARD_CAP;
  const working = capped ? rows.slice(0, DASHBOARD_CAP) : rows;
  const ids = working.map((r) => r.id);

  // One bounded query for container aggregates (no N+1).
  const containerAgg = await containerAggregates(admin, tenantId, ids);

  const dashboardRows: DashboardShipmentRow[] = working.map((r) => {
    const agg = containerAgg.get(r.id) ?? { total: 0, loaded: 0 };
    const milestone = coerceMilestone(r.ocean_milestone);
    return {
      milestone,
      bookingStatus: (r.booking_status as DashboardShipmentRow["bookingStatus"]) ?? null,
      plannedArrival: r.eta_previous,
      estimatedArrival: r.eta,
      plannedDeparture: r.etd,
      actualDeparture: r.atd,
      // Dashboard freshness is a BOUNDED proxy from the last sync; the detail view computes
      // precise freshness from the real event stream.
      freshness: classifyFreshness("CARRIER", r.tracking_synced_at, now),
      significantEtaChange: detectEtaChange(r.eta_previous, r.eta).significant,
      containersLoaded: agg.loaded,
      containersAtTransshipment: milestone === "TRANSSHIPMENT_ARRIVED" ? agg.total : 0,
      containersAwaitingCustoms: milestone === "DISCHARGED" || milestone === "CUSTOMS_PROCESSING" ? agg.total : 0,
    };
  });

  return { dashboard: buildShippingDashboard(dashboardRows, now), providers, ais, capped, cap: DASHBOARD_CAP };
}

async function containerAggregates(admin: Admin, tenantId: string, shipmentIds: string[]): Promise<Map<string, { total: number; loaded: number }>> {
  const map = new Map<string, { total: number; loaded: number }>();
  if (shipmentIds.length === 0) return map;
  const { data, error } = await admin
    .from("ocean_container")
    .select("shipment_id, status")
    .eq("tenant_id", tenantId)
    .in("shipment_id", shipmentIds)
    .returns<{ shipment_id: string; status: string }[]>();
  if (error) throw new Error(`[shipping] container agg failed: ${error.message}`);
  for (const c of data ?? []) {
    const a = map.get(c.shipment_id) ?? { total: 0, loaded: 0 };
    a.total++;
    if (c.status === "LOADED" || c.status === "ON_VESSEL") a.loaded++;
    map.set(c.shipment_id, a);
  }
  return map;
}

// ------------------------------------------------------------------- list ----

export type ShipmentFilters = { search?: string; milestone?: string; provider?: string };

export type ShipmentListItem = {
  id: string;
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  carrierName: string | null;
  bookingReference: string | null;
  masterBl: string | null;
  origin: string | null;
  destination: string | null;
  milestone: ShippingMilestone;
  milestoneLabel: string;
  provider: string;
  estimatedArrival: string | null;
  containerCount: number;
};

export type ShipmentListPage = { items: ShipmentListItem[]; page: number; pageSize: number; hasMore: boolean };

export async function listOceanShipments(filters: ShipmentFilters = {}, page = 0, pageSize = LIST_PAGE_SIZE): Promise<ShipmentListPage> {
  const { admin, tenantId } = await gate();
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE);
  const from = Math.max(0, page) * size;

  let q = admin
    .from("shipment")
    .select(`${OCEAN_SHIPMENT_COLS}, file:file_id(file_number, client:client_id(name))`)
    .eq("tenant_id", tenantId)
    .in("transport_mode", OCEAN_MODES);
  if (filters.milestone) q = q.eq("ocean_milestone", filters.milestone);
  if (filters.provider) q = q.eq("provider_code", filters.provider);
  if (filters.search && filters.search.trim()) {
    const s = filters.search.trim().replace(/[^a-zA-Z0-9\- ]/g, "").trim();
    if (s) q = q.or(`booking_reference.ilike.*${s}*,master_bl.ilike.*${s}*,bl_awb_ref.ilike.*${s}*,origin.ilike.*${s}*,destination.ilike.*${s}*`);
  }

  const { data, error } = await q
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + size)
    .returns<(ShipmentRow & FileJoin)[]>();
  if (error) throw new Error(`[shipping] list failed: ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > size;
  const pageRows = rows.slice(0, size);
  const agg = await containerAggregates(admin, tenantId, pageRows.map((r) => r.id));

  const items: ShipmentListItem[] = pageRows.map((r) => {
    const s = rowToOceanShipment(r, { fileNumber: r.file?.file_number ?? null, clientName: r.file?.client?.name ?? null });
    return {
      id: s.id, fileId: s.fileId, fileNumber: s.fileNumber, clientName: s.clientName,
      carrierName: s.carrierName, bookingReference: s.bookingReference, masterBl: s.masterBl,
      origin: s.origin, destination: s.destination, milestone: s.milestone, milestoneLabel: milestoneLabel(s.milestone),
      provider: s.providerCode, estimatedArrival: s.estimatedArrival,
      containerCount: agg.get(r.id)?.total ?? 0,
    };
  });
  return { items, page: Math.max(0, page), pageSize: size, hasMore };
}

// ------------------------------------------------------------------- detail ----

export type ShipmentDetail = {
  shipment: OceanShipment;
  version: number;
  containers: Container[];
  timeline: ShippingTrackingEvent[];
  position: ResolvedPosition;
  map: ShipmentMapProjection;
  customs: ShipmentCustomsSummary;
  provider: ShippingProviderConfig;
  alertsUnknownProvider: boolean;
  nextMilestones: ShippingMilestone[];
};

export async function getOceanShipmentDetail(id: string): Promise<ShipmentDetail | null> {
  const { admin, tenantId } = await gate();
  const now = nowIso();

  const { data, error } = await admin
    .from("shipment")
    .select(`${OCEAN_SHIPMENT_COLS}, tracking_version, file:file_id(file_number, client:client_id(name))`)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .in("transport_mode", OCEAN_MODES)
    .maybeSingle<ShipmentRow & FileJoin & { tracking_version: number }>();
  if (error) throw new Error(`[shipping] detail read failed: ${error.message}`);
  if (!data) return null;

  const shipment = rowToOceanShipment(data, { fileNumber: data.file?.file_number ?? null, clientName: data.file?.client?.name ?? null });

  const [containers, events, customs] = await Promise.all([
    readContainers(admin, tenantId, id),
    readEvents(admin, tenantId, id),
    getShipmentCustomsSummary(admin, tenantId, shipment.fileId),
  ]);

  const position = await resolveShipmentPosition(admin, tenantId, shipment.fileId, events, now);
  const milestoneMarkers = events
    .filter((e) => eventIsMilestone(e.eventType) && e.location?.latitude != null && e.location?.longitude != null)
    .map((e) => ({ milestone: e.eventType as ShippingMilestone, latitude: e.location!.latitude ?? null, longitude: e.location!.longitude ?? null, occurredAt: e.occurredAt }));
  const map = buildShipmentMapProjection({ current: position, milestoneMarkers });

  return {
    shipment,
    version: data.tracking_version,
    containers,
    timeline: sortEvents(events),
    position,
    map,
    customs,
    provider: resolveShippingProviderConfig(shipment.providerCode),
    alertsUnknownProvider: events.some((e) => e.confidence === "ESTIMATED" && e.source === "SYSTEM"),
    nextMilestones: nextMilestoneOptions(shipment.milestone),
  };
}

async function readContainers(admin: Admin, tenantId: string, shipmentId: string): Promise<Container[]> {
  const { data, error } = await admin
    .from("ocean_container")
    .select("id, shipment_id, container_number, iso_type, seal_number, gross_weight_kg, status, vessel_id, voyage_id, last_event_at, position_confidence")
    .eq("tenant_id", tenantId)
    .eq("shipment_id", shipmentId)
    .order("container_number", { ascending: true })
    .returns<ContainerRow[]>();
  if (error) throw new Error(`[shipping] containers read failed: ${error.message}`);
  return (data ?? []).map(rowToContainer);
}

async function readEvents(admin: Admin, tenantId: string, shipmentId: string): Promise<ShippingTrackingEvent[]> {
  const { data, error } = await admin
    .from("ocean_tracking_event")
    .select("id, tenant_id, shipment_id, container_id, event_type, occurred_at, received_at, source, provider_code, confidence, location_name, location_unlocode, latitude, longitude, vessel_imo, vessel_mmsi, vessel_name, voyage_reference, description, fingerprint")
    .eq("tenant_id", tenantId)
    .eq("shipment_id", shipmentId)
    .order("occurred_at", { ascending: false })
    .limit(TIMELINE_CAP)
    .returns<EventRow[]>();
  if (error) throw new Error(`[shipping] events read failed: ${error.message}`);
  return (data ?? []).map(rowToEvent);
}

/** Resolve current position: road GPS (from tracking_position) → port anchor from last
 *  milestone event. AIS is not wired in 7.2A, so vesselPosition is always null. */
async function resolveShipmentPosition(admin: Admin, tenantId: string, fileId: string, events: ShippingTrackingEvent[], now: string): Promise<ResolvedPosition> {
  const { data: pos } = await admin
    .from("tracking_position")
    .select("latitude, longitude, recorded_at")
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ latitude: number; longitude: number; recorded_at: string }>();

  const lastMilestone = latestMilestoneEvent(events);
  const portAnchor = lastMilestone && lastMilestone.location
    ? {
        name: lastMilestone.location.name ?? lastMilestone.location.unlocode ?? milestoneLabel(lastMilestone.eventType as ShippingMilestone),
        latitude: lastMilestone.location.latitude ?? null,
        longitude: lastMilestone.location.longitude ?? null,
        occurredAt: lastMilestone.occurredAt,
        confirmed: lastMilestone.confidence === "CONFIRMED",
      }
    : null;

  return resolveCurrentPosition({
    roadFix: pos ? { latitude: pos.latitude, longitude: pos.longitude, occurredAt: pos.recorded_at } : null,
    containerConfirmedOnVessel: false, // AIS not wired in 7.2A
    vesselPosition: null,
    portAnchor,
  }, now);
}

/** Reasonable next-milestone options for the manual action UI (not an exhaustive rail). */
function nextMilestoneOptions(current: ShippingMilestone): ShippingMilestone[] {
  const common: ShippingMilestone[] = ["EXCEPTION", "CANCELLED"];
  const order: ShippingMilestone[] = [
    "BOOKING_CREATED", "BOOKING_CONFIRMED", "EMPTY_RELEASED", "GATE_IN", "LOADED", "VESSEL_DEPARTED",
    "IN_TRANSIT", "TRANSSHIPMENT_ARRIVED", "TRANSSHIPMENT_DEPARTED", "VESSEL_ARRIVED", "DISCHARGED",
    "CUSTOMS_PROCESSING", "CUSTOMS_RELEASED", "AVAILABLE_FOR_PICKUP", "GATE_OUT", "DELIVERED", "EMPTY_RETURNED", "COMPLETED",
  ];
  const i = order.indexOf(current);
  const forward = i >= 0 ? order.slice(i + 1, i + 4) : [];
  return [...forward, ...common];
}

// ------------------------------------------------------------------- containers / vessels ----

export type ContainerListItem = { id: string; number: string; isoType: string | null; status: string; shipmentId: string; fileNumber: string | null; milestone: ShippingMilestone };
export type ContainerFilters = { search?: string; status?: string; isoType?: string };

export async function listContainers(filters: ContainerFilters = {}, page = 0, pageSize = LIST_PAGE_SIZE): Promise<{ items: ContainerListItem[]; page: number; pageSize: number; hasMore: boolean }> {
  const { admin, tenantId } = await gate();
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE);
  const from = Math.max(0, page) * size;
  let q = admin
    .from("ocean_container")
    .select("id, container_number, iso_type, status, shipment_id, shipment:shipment_id(ocean_milestone, file:file_id(file_number))")
    .eq("tenant_id", tenantId);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.isoType) q = q.eq("iso_type", filters.isoType);
  if (filters.search?.trim()) { const s = filters.search.trim().replace(/[^a-zA-Z0-9\- ]/g, "").trim(); if (s) q = q.ilike("container_number", `*${s}*`); }
  const { data, error } = await q
    .order("updated_at", { ascending: false })
    .range(from, from + size)
    .returns<{ id: string; container_number: string; iso_type: string | null; status: string; shipment_id: string; shipment: { ocean_milestone: string; file: { file_number: string } | null } | null }[]>();
  if (error) throw new Error(`[shipping] container list failed: ${error.message}`);
  const rows = data ?? [];
  const hasMore = rows.length > size;
  const items = rows.slice(0, size).map((r) => ({
    id: r.id, number: r.container_number, isoType: r.iso_type, status: r.status, shipmentId: r.shipment_id,
    fileNumber: r.shipment?.file?.file_number ?? null, milestone: coerceMilestone(r.shipment?.ocean_milestone ?? "BOOKING_CREATED"),
  }));
  return { items, page: Math.max(0, page), pageSize: size, hasMore };
}

export type VesselListItem = { id: string; name: string; imo: string | null; mmsi: string | null; flag: string | null };

export async function listVessels(page = 0, pageSize = LIST_PAGE_SIZE): Promise<{ items: VesselListItem[]; page: number; pageSize: number; hasMore: boolean }> {
  const { admin, tenantId } = await gate();
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE);
  const from = Math.max(0, page) * size;
  const { data, error } = await admin
    .from("ocean_vessel")
    .select("id, name, imo, mmsi, flag")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true })
    .range(from, from + size)
    .returns<VesselListItem[]>();
  if (error) throw new Error(`[shipping] vessel list failed: ${error.message}`);
  const rows = data ?? [];
  const hasMore = rows.length > size;
  return { items: rows.slice(0, size), page: Math.max(0, page), pageSize: size, hasMore };
}

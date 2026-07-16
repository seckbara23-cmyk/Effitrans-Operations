/**
 * Shipping Line Platform — management reads (Phase 7.2B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Admin client gated by transport:read; every tenant-scoped read is tenant-filtered
 * (leak guard). SQL-paginated. Option lists are bounded. No provider network call. Reuses
 * the 7.2A pure alert contracts for the attention queue.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { deriveShipmentAlerts, type ShippingAlert } from "./alerts";
import { classifyFreshness } from "./freshness";
import { detectEtaChange } from "./eta";
import { coerceMilestone, rowToEvent, type EventRow } from "./persistence";
import { milestoneLabel, type ShippingMilestone } from "./milestones";
import { sortEvents, type ShippingTrackingEvent } from "./events";
import type { BookingStatus } from "./domain";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
export const MGMT_PAGE_SIZE = 25;
const MAX_PAGE = 100;
const OPTION_CAP = 500;
const ATTENTION_CAP = 500;

async function gate(): Promise<{ admin: Admin; tenantId: string }> {
  const user = await assertPermission("transport:read");
  return { admin: getAdminSupabaseClient(), tenantId: user.tenantId };
}
function pageBounds(page: number, pageSize: number) {
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE);
  return { size, from: Math.max(0, page) * size };
}

// ---------------------------------------------------------------- carriers ----
export type CarrierItem = { id: string; code: string; name: string; scac: string | null; website: string | null; active: boolean; notes: string | null };
export async function listCarriers(filters: { search?: string; active?: string } = {}, page = 0): Promise<{ items: CarrierItem[]; page: number; hasMore: boolean }> {
  const { admin, tenantId } = await gate();
  const { size, from } = pageBounds(page, MGMT_PAGE_SIZE);
  let q = admin.from("ocean_carrier").select("id, code, name, scac, website, active, notes").eq("tenant_id", tenantId);
  if (filters.active === "active") q = q.eq("active", true);
  if (filters.active === "inactive") q = q.eq("active", false);
  if (filters.search?.trim()) { const s = filters.search.trim().replace(/[^a-zA-Z0-9\- ]/g, "").trim(); if (s) q = q.or(`name.ilike.*${s}*,code.ilike.*${s}*`); }
  const { data, error } = await q.order("name", { ascending: true }).range(from, from + size).returns<CarrierItem[]>();
  if (error) throw new Error(`[shipping] carriers failed: ${error.message}`);
  const rows = data ?? [];
  return { items: rows.slice(0, size), page: Math.max(0, page), hasMore: rows.length > size };
}

// ---------------------------------------------------------------- ports ----
export type PortItem = { id: string; unlocode: string | null; name: string; country: string | null; latitude: number | null; longitude: number | null; timezone: string | null; active: boolean; mappable: boolean };
export async function listPorts(filters: { search?: string; active?: string } = {}, page = 0): Promise<{ items: PortItem[]; page: number; hasMore: boolean }> {
  const { admin, tenantId } = await gate();
  const { size, from } = pageBounds(page, MGMT_PAGE_SIZE);
  let q = admin.from("ocean_port").select("id, unlocode, name, country, latitude, longitude, timezone, active").eq("tenant_id", tenantId);
  if (filters.active === "active") q = q.eq("active", true);
  if (filters.active === "inactive") q = q.eq("active", false);
  if (filters.search?.trim()) { const s = filters.search.trim().replace(/[^a-zA-Z0-9\- ]/g, "").trim(); if (s) q = q.or(`name.ilike.*${s}*,unlocode.ilike.*${s}*,country.ilike.*${s}*`); }
  const { data, error } = await q.order("name", { ascending: true }).range(from, from + size).returns<Omit<PortItem, "mappable">[]>();
  if (error) throw new Error(`[shipping] ports failed: ${error.message}`);
  const rows = (data ?? []).map((p) => ({ ...p, mappable: p.latitude != null && p.longitude != null }));
  return { items: rows.slice(0, size), page: Math.max(0, page), hasMore: rows.length > size };
}

// ---------------------------------------------------------------- vessels ----
export type VesselManagedItem = { id: string; name: string; imo: string | null; mmsi: string | null; flag: string | null; active: boolean; carrierName: string | null };
export async function listVesselsManaged(filters: { search?: string; active?: string } = {}, page = 0): Promise<{ items: VesselManagedItem[]; page: number; hasMore: boolean }> {
  const { admin, tenantId } = await gate();
  const { size, from } = pageBounds(page, MGMT_PAGE_SIZE);
  let q = admin.from("ocean_vessel").select("id, name, imo, mmsi, flag, active, carrier:carrier_id(name)").eq("tenant_id", tenantId);
  if (filters.active === "active") q = q.eq("active", true);
  if (filters.active === "inactive") q = q.eq("active", false);
  if (filters.search?.trim()) { const s = filters.search.trim().replace(/[^a-zA-Z0-9\- ]/g, "").trim(); if (s) q = q.or(`name.ilike.*${s}*,imo.ilike.*${s}*,mmsi.ilike.*${s}*`); }
  const { data, error } = await q.order("name", { ascending: true }).range(from, from + size).returns<{ id: string; name: string; imo: string | null; mmsi: string | null; flag: string | null; active: boolean; carrier: { name: string } | null }[]>();
  if (error) throw new Error(`[shipping] vessels failed: ${error.message}`);
  const rows = (data ?? []).map((v) => ({ id: v.id, name: v.name, imo: v.imo, mmsi: v.mmsi, flag: v.flag, active: v.active, carrierName: v.carrier?.name ?? null }));
  return { items: rows.slice(0, size), page: Math.max(0, page), hasMore: rows.length > size };
}

// ---------------------------------------------------------------- voyages ----
export type VoyageItem = { id: string; ref: string | null; status: string; vesselName: string | null; originPort: string | null; destinationPort: string | null; plannedDeparture: string | null; plannedArrival: string | null };
export async function listVoyages(page = 0): Promise<{ items: VoyageItem[]; page: number; hasMore: boolean }> {
  const { admin, tenantId } = await gate();
  const { size, from } = pageBounds(page, MGMT_PAGE_SIZE);
  const { data, error } = await admin
    .from("ocean_voyage")
    .select("id, carrier_voyage_ref, status, planned_departure, planned_arrival, vessel:vessel_id(name), origin:origin_port_id(name), dest:destination_port_id(name)")
    .eq("tenant_id", tenantId)
    .order("planned_departure", { ascending: false, nullsFirst: false })
    .range(from, from + size)
    .returns<{ id: string; carrier_voyage_ref: string | null; status: string; planned_departure: string | null; planned_arrival: string | null; vessel: { name: string } | null; origin: { name: string } | null; dest: { name: string } | null }[]>();
  if (error) throw new Error(`[shipping] voyages failed: ${error.message}`);
  const rows = data ?? [];
  const items = rows.slice(0, size).map((v) => ({ id: v.id, ref: v.carrier_voyage_ref, status: v.status, vesselName: v.vessel?.name ?? null, originPort: v.origin?.name ?? null, destinationPort: v.dest?.name ?? null, plannedDeparture: v.planned_departure, plannedArrival: v.planned_arrival }));
  return { items, page: Math.max(0, page), hasMore: rows.length > size };
}

// ---------------------------------------------------------------- option lists (bounded, for forms) ----
export type Option = { id: string; label: string };
export async function listCarrierOptions(): Promise<Option[]> {
  const { admin, tenantId } = await gate();
  const { data } = await admin.from("ocean_carrier").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name").limit(OPTION_CAP).returns<{ id: string; name: string }[]>();
  return (data ?? []).map((c) => ({ id: c.id, label: c.name }));
}
export async function listPortOptions(): Promise<Option[]> {
  const { admin, tenantId } = await gate();
  const { data } = await admin.from("ocean_port").select("id, name, unlocode").eq("tenant_id", tenantId).eq("active", true).order("name").limit(OPTION_CAP).returns<{ id: string; name: string; unlocode: string | null }[]>();
  return (data ?? []).map((p) => ({ id: p.id, label: p.unlocode ? `${p.name} (${p.unlocode})` : p.name }));
}
export async function listVesselOptions(): Promise<Option[]> {
  const { admin, tenantId } = await gate();
  const { data } = await admin.from("ocean_vessel").select("id, name, imo").eq("tenant_id", tenantId).eq("active", true).order("name").limit(OPTION_CAP).returns<{ id: string; name: string; imo: string | null }[]>();
  return (data ?? []).map((v) => ({ id: v.id, label: v.imo ? `${v.name} (IMO ${v.imo})` : v.name }));
}
export async function listVoyageOptions(): Promise<Option[]> {
  const { admin, tenantId } = await gate();
  const { data } = await admin.from("ocean_voyage").select("id, carrier_voyage_ref").eq("tenant_id", tenantId).order("planned_departure", { ascending: false, nullsFirst: false }).limit(OPTION_CAP).returns<{ id: string; carrier_voyage_ref: string | null }[]>();
  return (data ?? []).map((v) => ({ id: v.id, label: v.carrier_voyage_ref ?? v.id.slice(0, 8) }));
}

// ---------------------------------------------------------------- route legs ----
export type RouteLegItem = { sequence: number; mode: string; status: string; originPort: string | null; destinationPort: string | null; vesselName: string | null; plannedDeparture: string | null; plannedArrival: string | null; actualDeparture: string | null; actualArrival: string | null };
export async function listRouteLegs(shipmentId: string): Promise<RouteLegItem[]> {
  const { admin, tenantId } = await gate();
  const { data, error } = await admin
    .from("ocean_route_leg")
    .select("sequence, mode, status, planned_departure, planned_arrival, actual_departure, actual_arrival, origin:origin_port_id(name), dest:destination_port_id(name), vessel:vessel_id(name)")
    .eq("tenant_id", tenantId)
    .eq("shipment_id", shipmentId)
    .order("sequence", { ascending: true })
    .returns<{ sequence: number; mode: string; status: string; planned_departure: string | null; planned_arrival: string | null; actual_departure: string | null; actual_arrival: string | null; origin: { name: string } | null; dest: { name: string } | null; vessel: { name: string } | null }[]>();
  if (error) throw new Error(`[shipping] route legs failed: ${error.message}`);
  return (data ?? []).map((l) => ({ sequence: l.sequence, mode: l.mode, status: l.status, originPort: l.origin?.name ?? null, destinationPort: l.dest?.name ?? null, vesselName: l.vessel?.name ?? null, plannedDeparture: l.planned_departure, plannedArrival: l.planned_arrival, actualDeparture: l.actual_departure, actualArrival: l.actual_arrival }));
}

// ---------------------------------------------------------------- timeline (filter+paginate) ----
const EVENT_COLS = "id, tenant_id, shipment_id, container_id, event_type, occurred_at, received_at, source, provider_code, confidence, location_name, location_unlocode, latitude, longitude, vessel_imo, vessel_mmsi, vessel_name, voyage_reference, description, fingerprint";
export type TimelineFilters = { containerId?: string; eventType?: string; source?: string; confidence?: string; from?: string; to?: string };
export async function listShipmentEvents(shipmentId: string, filters: TimelineFilters = {}, page = 0): Promise<{ items: ShippingTrackingEvent[]; page: number; hasMore: boolean }> {
  const { admin, tenantId } = await gate();
  const { size, from } = pageBounds(page, MGMT_PAGE_SIZE);
  let q = admin.from("ocean_tracking_event").select(EVENT_COLS).eq("tenant_id", tenantId).eq("shipment_id", shipmentId);
  if (filters.containerId) q = q.eq("container_id", filters.containerId);
  if (filters.eventType) q = q.eq("event_type", filters.eventType);
  if (filters.source) q = q.eq("source", filters.source);
  if (filters.confidence) q = q.eq("confidence", filters.confidence);
  if (filters.from) q = q.gte("occurred_at", filters.from);
  if (filters.to) q = q.lte("occurred_at", filters.to);
  const { data, error } = await q.order("occurred_at", { ascending: false }).range(from, from + size).returns<EventRow[]>();
  if (error) throw new Error(`[shipping] timeline failed: ${error.message}`);
  const rows = data ?? [];
  const items = sortEvents(rows.slice(0, size).map(rowToEvent)).reverse(); // newest first for display
  return { items, page: Math.max(0, page), hasMore: rows.length > size };
}

// ---------------------------------------------------------------- attention queue ----
export type AttentionItem = { shipmentId: string; fileNumber: string | null; clientName: string | null; milestone: ShippingMilestone; milestoneLabel: string; alerts: ShippingAlert[] };
export async function getAttentionQueue(): Promise<AttentionItem[]> {
  const { admin, tenantId } = await gate();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("shipment")
    .select("id, ocean_milestone, booking_status, tracking_synced_at, eta, eta_previous, etd, atd, file:file_id(file_number, client:client_id(name))")
    .eq("tenant_id", tenantId)
    .in("transport_mode", ["SEA", "MULTIMODAL"])
    .order("updated_at", { ascending: false })
    .range(0, ATTENTION_CAP)
    .returns<{ id: string; ocean_milestone: string; booking_status: string | null; tracking_synced_at: string | null; eta: string | null; eta_previous: string | null; etd: string | null; atd: string | null; file: { file_number: string; client: { name: string } | null } | null }[]>();
  if (error) throw new Error(`[shipping] attention failed: ${error.message}`);

  const out: AttentionItem[] = [];
  for (const s of (data ?? []).slice(0, ATTENTION_CAP)) {
    const milestone = coerceMilestone(s.ocean_milestone);
    const alerts = deriveShipmentAlerts({
      milestone, bookingStatus: (s.booking_status as BookingStatus | null) ?? null, bookingCutoff: s.etd,
      plannedDeparture: s.etd, actualDeparture: s.atd, plannedArrival: s.eta_previous,
      significantEtaChange: detectEtaChange(s.eta_previous, s.eta).significant,
      freshness: classifyFreshness("CARRIER", s.tracking_synced_at, now),
      customsBlocked: false, hasUnknownProviderStatus: false,
    }, now).filter((a) => a.severity !== "info");
    if (alerts.length > 0) out.push({ shipmentId: s.id, fileNumber: s.file?.file_number ?? null, clientName: s.file?.client?.name ?? null, milestone, milestoneLabel: milestoneLabel(milestone), alerts });
  }
  return out;
}

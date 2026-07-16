/**
 * Air Cargo — management reads (Phase 7.3A). SERVER-ONLY. transport:read, tenant-filtered,
 * SQL-paginated. Attention queue reuses the pure air alert contracts.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { deriveAirAlerts, type AirAlert } from "./alerts";
import { coerceAirMilestone } from "./persistence";
import { airMilestoneLabel, type AirMilestone } from "./milestones";
import { classifyFreshness } from "@/lib/shipping/intelligence/freshness";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
export const PAGE = 25;
const MAX = 100;
const OPT_CAP = 500;
const ATT_CAP = 500;

async function gate() { const u = await assertPermission("transport:read"); return { admin: getAdminSupabaseClient(), tenantId: u.tenantId }; }
function pb(page: number) { const s = Math.min(Math.max(1, PAGE), MAX); return { s, from: Math.max(0, page) * s }; }

export type AirlineItem = { id: string; name: string; iata: string | null; icao: string | null; active: boolean };
export async function listAirlines(filters: { search?: string; active?: string } = {}, page = 0) {
  const { admin, tenantId } = await gate(); const { s, from } = pb(page);
  let q = admin.from("air_airline").select("id, name, iata, icao, active").eq("tenant_id", tenantId);
  if (filters.active === "active") q = q.eq("active", true); if (filters.active === "inactive") q = q.eq("active", false);
  if (filters.search?.trim()) { const t = filters.search.trim().replace(/[^a-zA-Z0-9\- ]/g, "").trim(); if (t) q = q.or(`name.ilike.*${t}*,iata.ilike.*${t}*`); }
  const { data, error } = await q.order("name").range(from, from + s).returns<AirlineItem[]>();
  if (error) throw new Error(`[air] airlines failed: ${error.message}`);
  const rows = data ?? []; return { items: rows.slice(0, s), page: Math.max(0, page), hasMore: rows.length > s };
}

export type AirportItem = { id: string; iata: string | null; icao: string | null; name: string; country: string | null; latitude: number | null; longitude: number | null; active: boolean; mappable: boolean };
export async function listAirports(filters: { search?: string; active?: string } = {}, page = 0) {
  const { admin, tenantId } = await gate(); const { s, from } = pb(page);
  let q = admin.from("air_airport").select("id, iata, icao, name, country, latitude, longitude, active").eq("tenant_id", tenantId);
  if (filters.active === "active") q = q.eq("active", true); if (filters.active === "inactive") q = q.eq("active", false);
  if (filters.search?.trim()) { const t = filters.search.trim().replace(/[^a-zA-Z0-9\- ]/g, "").trim(); if (t) q = q.or(`name.ilike.*${t}*,iata.ilike.*${t}*,country.ilike.*${t}*`); }
  const { data, error } = await q.order("name").range(from, from + s).returns<Omit<AirportItem, "mappable">[]>();
  if (error) throw new Error(`[air] airports failed: ${error.message}`);
  const rows = (data ?? []).map((p) => ({ ...p, mappable: p.latitude != null && p.longitude != null }));
  return { items: rows.slice(0, s), page: Math.max(0, page), hasMore: rows.length > s };
}

export type FlightItem = { id: string; flightNumber: string | null; status: string; airlineName: string | null; origin: string | null; destination: string | null; scheduledDeparture: string | null; scheduledArrival: string | null };
export async function listFlights(page = 0) {
  const { admin, tenantId } = await gate(); const { s, from } = pb(page);
  const { data, error } = await admin.from("air_flight").select("id, flight_number, status, scheduled_departure, scheduled_arrival, airline:airline_id(name), origin:origin_airport_id(iata), dest:destination_airport_id(iata)").eq("tenant_id", tenantId).order("scheduled_departure", { ascending: false, nullsFirst: false }).range(from, from + s).returns<{ id: string; flight_number: string | null; status: string; scheduled_departure: string | null; scheduled_arrival: string | null; airline: { name: string } | null; origin: { iata: string | null } | null; dest: { iata: string | null } | null }[]>();
  if (error) throw new Error(`[air] flights failed: ${error.message}`);
  const rows = data ?? [];
  const items = rows.slice(0, s).map((f) => ({ id: f.id, flightNumber: f.flight_number, status: f.status, airlineName: f.airline?.name ?? null, origin: f.origin?.iata ?? null, destination: f.dest?.iata ?? null, scheduledDeparture: f.scheduled_departure, scheduledArrival: f.scheduled_arrival }));
  return { items, page: Math.max(0, page), hasMore: rows.length > s };
}

export type Option = { id: string; label: string };
export async function listAirlineOptions(): Promise<Option[]> {
  const { admin, tenantId } = await gate();
  const { data } = await admin.from("air_airline").select("id, name, iata").eq("tenant_id", tenantId).eq("active", true).order("name").limit(OPT_CAP).returns<{ id: string; name: string; iata: string | null }[]>();
  return (data ?? []).map((a) => ({ id: a.id, label: a.iata ? `${a.name} (${a.iata})` : a.name }));
}
export async function listAirportOptions(): Promise<Option[]> {
  const { admin, tenantId } = await gate();
  const { data } = await admin.from("air_airport").select("id, name, iata").eq("tenant_id", tenantId).eq("active", true).order("name").limit(OPT_CAP).returns<{ id: string; name: string; iata: string | null }[]>();
  return (data ?? []).map((a) => ({ id: a.id, label: a.iata ? `${a.name} (${a.iata})` : a.name }));
}
export async function listFlightOptions(): Promise<Option[]> {
  const { admin, tenantId } = await gate();
  const { data } = await admin.from("air_flight").select("id, flight_number").eq("tenant_id", tenantId).order("scheduled_departure", { ascending: false, nullsFirst: false }).limit(OPT_CAP).returns<{ id: string; flight_number: string | null }[]>();
  return (data ?? []).map((f) => ({ id: f.id, label: f.flight_number ?? f.id.slice(0, 8) }));
}

export type AirAttentionItem = { shipmentId: string; fileNumber: string | null; clientName: string | null; milestone: AirMilestone; milestoneLabel: string; alerts: AirAlert[] };
export async function getAirAttentionQueue(): Promise<AirAttentionItem[]> {
  const { admin, tenantId } = await gate(); const now = new Date().toISOString();
  const { data, error } = await admin.from("shipment").select("id, air_milestone, etd, atd, eta, eta_previous, tracking_synced_at, file:file_id(file_number, client:client_id(name))").eq("tenant_id", tenantId).eq("transport_mode", "AIR").order("updated_at", { ascending: false }).range(0, ATT_CAP).returns<{ id: string; air_milestone: string; etd: string | null; atd: string | null; eta: string | null; eta_previous: string | null; tracking_synced_at: string | null; file: { file_number: string; client: { name: string } | null } | null }[]>();
  if (error) throw new Error(`[air] attention failed: ${error.message}`);
  const out: AirAttentionItem[] = [];
  for (const s of (data ?? []).slice(0, ATT_CAP)) {
    const milestone = coerceAirMilestone(s.air_milestone);
    const alerts = deriveAirAlerts({ milestone, scheduledDeparture: s.etd, actualDeparture: s.atd, scheduledArrival: s.eta_previous, estimatedArrival: s.eta, freshness: classifyFreshness("CARRIER", s.tracking_synced_at, now), connectionMissed: false, uldMismatch: false, cargoMismatch: false, hasUnknownEvent: false }, now).filter((a) => a.severity !== "info");
    if (alerts.length) out.push({ shipmentId: s.id, fileNumber: s.file?.file_number ?? null, clientName: s.file?.client?.name ?? null, milestone, milestoneLabel: airMilestoneLabel(milestone), alerts });
  }
  return out;
}

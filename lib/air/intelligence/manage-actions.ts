"use server";

/**
 * Air Cargo — management write actions (Phase 7.3A). SERVER ACTIONS. Reference-data
 * (airline/airport/flight) on transport:manage; shipment-linked (AWB/ULD/cargo/leg/ETA) on
 * transport:update. Every relationship id verified in-tenant (no cross-tenant injection).
 * Retire-not-delete for reference data. Safe audit (no coordinates/PII).
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { isValidIataAirline, isValidIataAirport, isValidIcaoAirline, isValidIcaoAirport, normalizeCode } from "./validators";
import { isSafeUrl, validateVoyageChronology, normalizeReference } from "@/lib/shipping/intelligence/manage-validate";
import { isValidCoordinate } from "@/lib/shipping/intelligence/validators";
import type { Database } from "@/lib/db/types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Upd<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type AirMgmtResult = { ok: true; id?: string } | { ok: false; error: string };

function rv() { revalidatePath("/air"); revalidatePath("/air/airlines"); revalidatePath("/air/airports"); revalidatePath("/air/flights"); }
async function inTenant(admin: Admin, table: "air_airline" | "air_airport" | "air_flight" | "air_uld" | "shipment", id: string | null | undefined, tenantId: string): Promise<boolean> {
  if (!id) return true;
  const { data } = await admin.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return !!data;
}

// ---------------- airline ----------------
export async function createAirline(input: { name: string; iata?: string | null; icao?: string | null; website?: string | null; notes?: string | null }): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const name = normalizeReference(input.name, 128);
  if (!name) return { ok: false, error: "name_required" };
  if (!isValidIataAirline(input.iata)) return { ok: false, error: "invalid_iata" };
  if (!isValidIcaoAirline(input.icao)) return { ok: false, error: "invalid_icao" };
  if (!isSafeUrl(input.website)) return { ok: false, error: "invalid_url" };
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin.from("air_airline").insert({ tenant_id: user.tenantId, name, iata: normalizeCode(input.iata), icao: normalizeCode(input.icao), website: normalizeReference(input.website, 256), notes: normalizeReference(input.notes, 1000) }).select("id");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.AIR_AIRLINE_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "air_airline", entityId: data?.[0]?.id, after: { fields: ["name"] } });
  rv(); return { ok: true, id: data?.[0]?.id };
}
export async function updateAirline(id: string, input: { name?: string; website?: string | null; notes?: string | null; active?: boolean }): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (input.website !== undefined && !isSafeUrl(input.website)) return { ok: false, error: "invalid_url" };
  const admin = getAdminSupabaseClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = normalizeReference(input.name, 128);
  if (input.website !== undefined) patch.website = normalizeReference(input.website, 256);
  if (input.notes !== undefined) patch.notes = normalizeReference(input.notes, 1000);
  if (input.active !== undefined) patch.active = input.active;
  const { error } = await admin.from("air_airline").update(patch as Upd<"air_airline">).eq("id", id).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.AIR_AIRLINE_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "air_airline", entityId: id, after: { fields: Object.keys(patch) } });
  rv(); return { ok: true, id };
}

// ---------------- airport ----------------
export async function createAirport(input: { iata?: string | null; icao?: string | null; name: string; city?: string | null; country?: string | null; latitude?: number | null; longitude?: number | null; timezone?: string | null }): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const name = normalizeReference(input.name, 128);
  if (!name) return { ok: false, error: "name_required" };
  if (!isValidIataAirport(input.iata)) return { ok: false, error: "invalid_iata" };
  if (!isValidIcaoAirport(input.icao)) return { ok: false, error: "invalid_icao" };
  const hasCoord = input.latitude != null || input.longitude != null;
  if (hasCoord && !(input.latitude != null && input.longitude != null && isValidCoordinate(input.latitude, input.longitude))) return { ok: false, error: "invalid_coordinate" };
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin.from("air_airport").insert({ tenant_id: user.tenantId, iata: normalizeCode(input.iata), icao: normalizeCode(input.icao), name, city: normalizeReference(input.city, 64), country: normalizeReference(input.country, 64), latitude: input.latitude ?? null, longitude: input.longitude ?? null, timezone: normalizeReference(input.timezone, 64) }).select("id");
  if (error) return { ok: false, error: error.code === "23505" ? "duplicate_iata" : error.message };
  await writeAudit({ action: AuditActions.AIR_AIRPORT_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "air_airport", entityId: data?.[0]?.id, after: { fields: ["name", "iata"] } });
  rv(); return { ok: true, id: data?.[0]?.id };
}
export async function updateAirport(id: string, input: { name?: string; country?: string | null; latitude?: number | null; longitude?: number | null; timezone?: string | null; active?: boolean }): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const hasCoord = input.latitude != null || input.longitude != null;
  if (hasCoord && !(input.latitude != null && input.longitude != null && isValidCoordinate(input.latitude, input.longitude))) return { ok: false, error: "invalid_coordinate" };
  const admin = getAdminSupabaseClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = normalizeReference(input.name, 128);
  if (input.country !== undefined) patch.country = normalizeReference(input.country, 64);
  if (input.latitude !== undefined) patch.latitude = input.latitude;
  if (input.longitude !== undefined) patch.longitude = input.longitude;
  if (input.timezone !== undefined) patch.timezone = normalizeReference(input.timezone, 64);
  if (input.active !== undefined) patch.active = input.active;
  const { error } = await admin.from("air_airport").update(patch as Upd<"air_airport">).eq("id", id).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.AIR_AIRPORT_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "air_airport", entityId: id, after: { fields: Object.keys(patch) } });
  rv(); return { ok: true, id };
}

// ---------------- flight ----------------
export async function createFlight(input: { flightNumber?: string | null; airlineId?: string | null; originAirportId?: string | null; destinationAirportId?: string | null; scheduledDeparture?: string | null; scheduledArrival?: string | null; allowCorrection?: boolean }): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const chrono = validateVoyageChronology({ plannedDeparture: input.scheduledDeparture, plannedArrival: input.scheduledArrival }, input.allowCorrection);
  if (!chrono.ok) return { ok: false, error: chrono.reason };
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "air_airline", input.airlineId, user.tenantId))) return { ok: false, error: "invalid_airline" };
  if (!(await inTenant(admin, "air_airport", input.originAirportId, user.tenantId))) return { ok: false, error: "invalid_airport" };
  if (!(await inTenant(admin, "air_airport", input.destinationAirportId, user.tenantId))) return { ok: false, error: "invalid_airport" };
  const { data, error } = await admin.from("air_flight").insert({ tenant_id: user.tenantId, flight_number: normalizeReference(input.flightNumber, 16), airline_id: input.airlineId ?? null, origin_airport_id: input.originAirportId ?? null, destination_airport_id: input.destinationAirportId ?? null, scheduled_departure: input.scheduledDeparture ?? null, scheduled_arrival: input.scheduledArrival ?? null }).select("id");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.AIR_FLIGHT_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "air_flight", entityId: data?.[0]?.id, after: { fields: ["flight_number"], airlineId: input.airlineId ?? null } });
  rv(); return { ok: true, id: data?.[0]?.id };
}

export async function upsertFlightLeg(flightId: string, leg: { sequence: number; originAirportId?: string | null; destinationAirportId?: string | null; connectionAirportId?: string | null; std?: string | null; sta?: string | null }): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!Number.isInteger(leg.sequence) || leg.sequence < 1) return { ok: false, error: "invalid_sequence" };
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "air_flight", flightId, user.tenantId))) return { ok: false, error: "not_found" };
  for (const a of [leg.originAirportId, leg.destinationAirportId, leg.connectionAirportId]) if (!(await inTenant(admin, "air_airport", a, user.tenantId))) return { ok: false, error: "invalid_airport" };
  const chrono = validateVoyageChronology({ plannedDeparture: leg.std, plannedArrival: leg.sta });
  if (!chrono.ok) return { ok: false, error: chrono.reason };
  const { error } = await admin.from("air_flight_leg").upsert({ tenant_id: user.tenantId, flight_id: flightId, sequence: leg.sequence, origin_airport_id: leg.originAirportId ?? null, destination_airport_id: leg.destinationAirportId ?? null, connection_airport_id: leg.connectionAirportId ?? null, std: leg.std ?? null, sta: leg.sta ?? null }, { onConflict: "tenant_id,flight_id,sequence" });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.AIR_FLIGHT_LEG_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "air_flight", entityId: flightId, after: { sequence: leg.sequence } });
  rv(); return { ok: true };
}

// ---------------- AWB / ULD / cargo (shipment-linked) ----------------
export async function updateAwb(shipmentId: string, input: { mawb?: string | null; hawb?: string | null; flightId?: string | null; status?: string | null }): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "shipment", shipmentId, user.tenantId))) return { ok: false, error: "not_found" };
  if (input.flightId !== undefined && !(await inTenant(admin, "air_flight", input.flightId, user.tenantId))) return { ok: false, error: "invalid_flight" };
  if (input.status && !["DRAFT", "ISSUED", "CONFIRMED", "CANCELLED"].includes(input.status)) return { ok: false, error: "invalid_status" };
  const { error } = await admin.from("air_awb").upsert({ tenant_id: user.tenantId, shipment_id: shipmentId, mawb: normalizeReference(input.mawb, 32), hawb: normalizeReference(input.hawb, 32), flight_id: input.flightId ?? null, status: (input.status as string) || "DRAFT" }, { onConflict: "tenant_id,shipment_id" });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.AIR_AWB_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId, after: { fields: ["mawb", "hawb"] } });
  revalidatePath(`/air/shipments/${shipmentId}`); return { ok: true, id: shipmentId };
}

export async function createUld(shipmentId: string, input: { number: string; type?: string | null; owner?: string | null; flightId?: string | null }): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  const num = normalizeReference(input.number, 32);
  if (!num) return { ok: false, error: "invalid_uld_number" };
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "shipment", shipmentId, user.tenantId))) return { ok: false, error: "not_found" };
  if (input.flightId && !(await inTenant(admin, "air_flight", input.flightId, user.tenantId))) return { ok: false, error: "invalid_flight" };
  const { data, error } = await admin.from("air_uld").insert({ tenant_id: user.tenantId, shipment_id: shipmentId, uld_number: num, uld_type: normalizeReference(input.type, 16), owner: normalizeReference(input.owner, 64), flight_id: input.flightId ?? null }).select("id");
  if (error) return { ok: false, error: error.code === "23505" ? "duplicate_uld" : error.message };
  await writeAudit({ action: AuditActions.AIR_ULD_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "air_uld", entityId: data?.[0]?.id, after: { shipmentId } });
  revalidatePath(`/air/shipments/${shipmentId}`); revalidatePath("/air/ulds"); return { ok: true, id: data?.[0]?.id };
}

export async function createCargoPiece(shipmentId: string, input: { pieceCount: number; weightKg?: number | null; volumeM3?: number | null; dimensions?: string | null; specialHandling?: string | null; dangerousGoods?: boolean; temperatureControlled?: boolean; uldId?: string | null }): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  if (!Number.isInteger(input.pieceCount) || input.pieceCount < 1) return { ok: false, error: "invalid_piece_count" };
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "shipment", shipmentId, user.tenantId))) return { ok: false, error: "not_found" };
  if (input.uldId && !(await inTenant(admin, "air_uld", input.uldId, user.tenantId))) return { ok: false, error: "invalid_uld" };
  const { data, error } = await admin.from("air_cargo_piece").insert({ tenant_id: user.tenantId, shipment_id: shipmentId, uld_id: input.uldId ?? null, piece_count: input.pieceCount, weight_kg: input.weightKg ?? null, volume_m3: input.volumeM3 ?? null, dimensions: normalizeReference(input.dimensions, 64), special_handling: normalizeReference(input.specialHandling, 64), dangerous_goods: !!input.dangerousGoods, temperature_controlled: !!input.temperatureControlled }).select("id");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.AIR_CARGO_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "air_cargo_piece", entityId: data?.[0]?.id, after: { shipmentId, dangerousGoods: !!input.dangerousGoods } });
  revalidatePath(`/air/shipments/${shipmentId}`); return { ok: true, id: data?.[0]?.id };
}

export async function updateAirEta(shipmentId: string, value: string, source: string): Promise<AirMgmtResult> {
  let user; try { user = await assertPermission("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  if (!Number.isFinite(new Date(value).getTime())) return { ok: false, error: "invalid_timestamp" };
  if (!["CARRIER", "PORT", "AIS_DERIVED", "MANUAL", "SYSTEM_ESTIMATE"].includes(source)) return { ok: false, error: "invalid_source" };
  const admin = getAdminSupabaseClient();
  const { data: s } = await admin.from("shipment").select("eta").eq("id", shipmentId).eq("tenant_id", user.tenantId).maybeSingle<{ eta: string | null }>();
  if (!s) return { ok: false, error: "not_found" };
  const conf = source === "CARRIER" ? "HIGH" : source === "SYSTEM_ESTIMATE" ? "LOW" : "MEDIUM";
  const { error } = await admin.from("shipment").update({ eta: new Date(value).toISOString(), eta_previous: s.eta, eta_source: source, eta_confidence: conf, eta_calculated_at: new Date().toISOString() }).eq("id", shipmentId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.AIR_ETA_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId, after: { source, confidence: conf } });
  revalidatePath(`/air/shipments/${shipmentId}`); return { ok: true, id: shipmentId };
}

"use server";

/**
 * Shipping Line Platform — management write actions (Phase 7.2B). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Tenant + actor from the SESSION (never the browser). Reference-data management
 * (carrier/port/vessel/voyage) gates on transport:manage; shipment-linked edits
 * (booking/BL, container, route, ETA) gate on transport:update. Every relationship id is
 * verified to belong to the caller's tenant (no cross-tenant injection). No destructive
 * delete of referenced reference data — retire (active=false) instead. Audit carries safe
 * metadata only (ids + changed field names), never coordinates/PII/credentials.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { normalizeContainerNumber, isValidIMO, isValidMMSI, isValidCoordinate } from "./validators";
import { isSafeUrl, isValidPortUnlocode, validateVoyageChronology, normalizeReference } from "./manage-validate";
import { normalizeUnlocode } from "./validators";
import type { Database } from "@/lib/db/types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Upd<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type MgmtResult = { ok: true; id?: string } | { ok: false; error: string };

async function req(perm: string) {
  return assertPermission(perm);
}
function rv() {
  revalidatePath("/shipping");
  revalidatePath("/shipping/carriers");
  revalidatePath("/shipping/ports");
  revalidatePath("/shipping/vessels");
  revalidatePath("/shipping/voyages");
}

/** True iff `id` is null or names a row of `table` in the caller's tenant. */
async function inTenant(admin: Admin, table: "ocean_carrier" | "ocean_vessel" | "ocean_port" | "ocean_voyage" | "shipment", id: string | null | undefined, tenantId: string): Promise<boolean> {
  if (!id) return true;
  const { data } = await admin.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------- carriers ----
export async function createCarrier(input: { code: string; name: string; scac?: string | null; website?: string | null; notes?: string | null }): Promise<MgmtResult> {
  let user; try { user = await req("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const code = normalizeReference(input.code, 32), name = normalizeReference(input.name, 128);
  if (!code || !name) return { ok: false, error: "name_required" };
  if (!isSafeUrl(input.website)) return { ok: false, error: "invalid_url" };
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin.from("ocean_carrier").insert({ tenant_id: user.tenantId, code, name, scac: normalizeReference(input.scac, 8), website: normalizeReference(input.website, 256), notes: normalizeReference(input.notes, 1000) }).select("id");
  if (error) return { ok: false, error: error.code === "23505" ? "duplicate_code" : error.message };
  await writeAudit({ action: AuditActions.SHIPPING_CARRIER_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "ocean_carrier", entityId: data?.[0]?.id, after: { fields: ["code", "name"] } });
  rv(); return { ok: true, id: data?.[0]?.id };
}
export async function updateCarrier(id: string, input: { name?: string; scac?: string | null; website?: string | null; notes?: string | null; active?: boolean }): Promise<MgmtResult> {
  let user; try { user = await req("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (input.website !== undefined && !isSafeUrl(input.website)) return { ok: false, error: "invalid_url" };
  const admin = getAdminSupabaseClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = normalizeReference(input.name, 128);
  if (input.scac !== undefined) patch.scac = normalizeReference(input.scac, 8);
  if (input.website !== undefined) patch.website = normalizeReference(input.website, 256);
  if (input.notes !== undefined) patch.notes = normalizeReference(input.notes, 1000);
  if (input.active !== undefined) patch.active = input.active;
  const { error } = await admin.from("ocean_carrier").update(patch as Upd<"ocean_carrier">).eq("id", id).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_CARRIER_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "ocean_carrier", entityId: id, after: { fields: Object.keys(patch) } });
  rv(); return { ok: true, id };
}

// ---------------------------------------------------------------- ports ----
export async function createPort(input: { unlocode?: string | null; name: string; country?: string | null; latitude?: number | null; longitude?: number | null; timezone?: string | null }): Promise<MgmtResult> {
  let user; try { user = await req("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const name = normalizeReference(input.name, 128);
  if (!name) return { ok: false, error: "name_required" };
  if (!isValidPortUnlocode(input.unlocode)) return { ok: false, error: "invalid_unlocode" };
  const hasCoord = input.latitude != null || input.longitude != null;
  if (hasCoord && !(input.latitude != null && input.longitude != null && isValidCoordinate(input.latitude, input.longitude))) return { ok: false, error: "invalid_coordinate" };
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin.from("ocean_port").insert({ tenant_id: user.tenantId, unlocode: input.unlocode ? normalizeUnlocode(input.unlocode) : null, name, country: normalizeReference(input.country, 64), latitude: input.latitude ?? null, longitude: input.longitude ?? null, timezone: normalizeReference(input.timezone, 64) }).select("id");
  if (error) return { ok: false, error: error.code === "23505" ? "duplicate_unlocode" : error.message };
  await writeAudit({ action: AuditActions.SHIPPING_PORT_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "ocean_port", entityId: data?.[0]?.id, after: { fields: ["name", "unlocode"] } });
  rv(); return { ok: true, id: data?.[0]?.id };
}
export async function updatePort(id: string, input: { name?: string; country?: string | null; latitude?: number | null; longitude?: number | null; timezone?: string | null; active?: boolean }): Promise<MgmtResult> {
  let user; try { user = await req("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
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
  const { error } = await admin.from("ocean_port").update(patch as Upd<"ocean_port">).eq("id", id).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_PORT_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "ocean_port", entityId: id, after: { fields: Object.keys(patch) } });
  rv(); return { ok: true, id };
}

// ---------------------------------------------------------------- vessels ----
export async function createVessel(input: { name: string; imo?: string | null; mmsi?: string | null; flag?: string | null; carrierId?: string | null }): Promise<MgmtResult> {
  let user; try { user = await req("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const name = normalizeReference(input.name, 128);
  if (!name) return { ok: false, error: "name_required" };
  if (input.imo && !isValidIMO(input.imo)) return { ok: false, error: "invalid_imo" };
  if (input.mmsi && !isValidMMSI(input.mmsi)) return { ok: false, error: "invalid_mmsi" };
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "ocean_carrier", input.carrierId, user.tenantId))) return { ok: false, error: "invalid_carrier" };
  const { data, error } = await admin.from("ocean_vessel").insert({ tenant_id: user.tenantId, name, imo: normalizeReference(input.imo, 16), mmsi: normalizeReference(input.mmsi, 16), flag: normalizeReference(input.flag, 64), carrier_id: input.carrierId ?? null }).select("id");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_VESSEL_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "ocean_vessel", entityId: data?.[0]?.id, after: { fields: ["name"], carrierId: input.carrierId ?? null } });
  rv(); return { ok: true, id: data?.[0]?.id };
}
export async function updateVessel(id: string, input: { name?: string; imo?: string | null; mmsi?: string | null; flag?: string | null; carrierId?: string | null; active?: boolean }): Promise<MgmtResult> {
  let user; try { user = await req("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (input.imo && !isValidIMO(input.imo)) return { ok: false, error: "invalid_imo" };
  if (input.mmsi && !isValidMMSI(input.mmsi)) return { ok: false, error: "invalid_mmsi" };
  const admin = getAdminSupabaseClient();
  if (input.carrierId !== undefined && !(await inTenant(admin, "ocean_carrier", input.carrierId, user.tenantId))) return { ok: false, error: "invalid_carrier" };
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = normalizeReference(input.name, 128);
  if (input.imo !== undefined) patch.imo = normalizeReference(input.imo, 16);
  if (input.mmsi !== undefined) patch.mmsi = normalizeReference(input.mmsi, 16);
  if (input.flag !== undefined) patch.flag = normalizeReference(input.flag, 64);
  if (input.carrierId !== undefined) patch.carrier_id = input.carrierId ?? null;
  if (input.active !== undefined) patch.active = input.active;
  const { error } = await admin.from("ocean_vessel").update(patch as Upd<"ocean_vessel">).eq("id", id).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_VESSEL_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "ocean_vessel", entityId: id, after: { fields: Object.keys(patch) } });
  rv(); return { ok: true, id };
}

// ---------------------------------------------------------------- voyages ----
export async function createVoyage(input: { carrierVoyageRef?: string | null; vesselId?: string | null; originPortId?: string | null; destinationPortId?: string | null; plannedDeparture?: string | null; plannedArrival?: string | null; allowCorrection?: boolean }): Promise<MgmtResult> {
  let user; try { user = await req("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const chrono = validateVoyageChronology({ plannedDeparture: input.plannedDeparture, plannedArrival: input.plannedArrival }, input.allowCorrection);
  if (!chrono.ok) return { ok: false, error: chrono.reason };
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "ocean_vessel", input.vesselId, user.tenantId))) return { ok: false, error: "invalid_vessel" };
  if (!(await inTenant(admin, "ocean_port", input.originPortId, user.tenantId))) return { ok: false, error: "invalid_port" };
  if (!(await inTenant(admin, "ocean_port", input.destinationPortId, user.tenantId))) return { ok: false, error: "invalid_port" };
  const { data, error } = await admin.from("ocean_voyage").insert({ tenant_id: user.tenantId, carrier_voyage_ref: normalizeReference(input.carrierVoyageRef, 64), vessel_id: input.vesselId ?? null, origin_port_id: input.originPortId ?? null, destination_port_id: input.destinationPortId ?? null, planned_departure: input.plannedDeparture ?? null, planned_arrival: input.plannedArrival ?? null }).select("id");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_VOYAGE_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "ocean_voyage", entityId: data?.[0]?.id, after: { fields: ["carrier_voyage_ref"], vesselId: input.vesselId ?? null } });
  rv(); return { ok: true, id: data?.[0]?.id };
}

// ---------------------------------------------------------------- booking / BL ----
export async function updateBookingBl(shipmentId: string, input: { bookingReference?: string | null; bookingStatus?: string | null; masterBl?: string | null; houseBl?: string | null; carrierId?: string | null }): Promise<MgmtResult> {
  let user; try { user = await req("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "shipment", shipmentId, user.tenantId))) return { ok: false, error: "not_found" };
  if (input.carrierId !== undefined && !(await inTenant(admin, "ocean_carrier", input.carrierId, user.tenantId))) return { ok: false, error: "invalid_carrier" };
  if (input.bookingStatus && !["DRAFT", "REQUESTED", "CONFIRMED", "AMENDED", "CANCELLED"].includes(input.bookingStatus)) return { ok: false, error: "invalid_booking_status" };
  const patch: Record<string, unknown> = {};
  if (input.bookingReference !== undefined) patch.booking_reference = normalizeReference(input.bookingReference, 64);
  if (input.bookingStatus !== undefined) patch.booking_status = input.bookingStatus || null;
  if (input.masterBl !== undefined) patch.master_bl = normalizeReference(input.masterBl, 64);
  if (input.houseBl !== undefined) patch.house_bl = normalizeReference(input.houseBl, 64);
  if (input.carrierId !== undefined) patch.carrier_id = input.carrierId ?? null;
  const { error } = await admin.from("shipment").update(patch as Upd<"shipment">).eq("id", shipmentId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_BOOKING_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId, after: { fields: Object.keys(patch) } });
  revalidatePath(`/shipping/shipments/${shipmentId}`); return { ok: true, id: shipmentId };
}

// ---------------------------------------------------------------- containers ----
export async function createContainer(shipmentId: string, input: { number: string; isoType?: string | null; sealNumber?: string | null; grossWeightKg?: number | null }): Promise<MgmtResult> {
  let user; try { user = await req("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  const num = normalizeContainerNumber(input.number);
  if (!num) return { ok: false, error: "invalid_container_number" };
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "shipment", shipmentId, user.tenantId))) return { ok: false, error: "not_found" };
  const { data, error } = await admin.from("ocean_container").insert({ tenant_id: user.tenantId, shipment_id: shipmentId, container_number: num, iso_type: normalizeReference(input.isoType, 8), seal_number: normalizeReference(input.sealNumber, 32), gross_weight_kg: input.grossWeightKg ?? null }).select("id");
  if (error) return { ok: false, error: error.code === "23505" ? "duplicate_container" : error.message };
  await writeAudit({ action: AuditActions.SHIPPING_CONTAINER_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "ocean_container", entityId: data?.[0]?.id, after: { shipmentId } });
  revalidatePath(`/shipping/shipments/${shipmentId}`); revalidatePath("/shipping/containers"); return { ok: true, id: data?.[0]?.id };
}

/** Move a container to another shipment. Requires confirmation; both must be same-tenant;
 *  immutable tracking history is preserved (events reference the container, not touched). */
export async function reassignContainer(containerId: string, newShipmentId: string, confirm: boolean): Promise<MgmtResult> {
  let user; try { user = await req("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  if (!confirm) return { ok: false, error: "confirmation_required" };
  const admin = getAdminSupabaseClient();
  const { data: cont } = await admin.from("ocean_container").select("id, shipment_id, container_number").eq("id", containerId).eq("tenant_id", user.tenantId).maybeSingle<{ id: string; shipment_id: string; container_number: string }>();
  if (!cont) return { ok: false, error: "not_found" };
  if (cont.shipment_id === newShipmentId) return { ok: false, error: "same_shipment" };
  if (!(await inTenant(admin, "shipment", newShipmentId, user.tenantId))) return { ok: false, error: "invalid_shipment" };
  // Reject a conflicting active duplicate on the target shipment.
  const { data: dup } = await admin.from("ocean_container").select("id").eq("tenant_id", user.tenantId).eq("shipment_id", newShipmentId).eq("container_number", cont.container_number).maybeSingle();
  if (dup) return { ok: false, error: "conflict_on_target" };
  const { error } = await admin.from("ocean_container").update({ shipment_id: newShipmentId }).eq("id", containerId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_CONTAINER_REASSIGNED, actorId: user.id, tenantId: user.tenantId, entity: "ocean_container", entityId: containerId, before: { shipmentId: cont.shipment_id }, after: { shipmentId: newShipmentId } });
  revalidatePath("/shipping/containers"); return { ok: true, id: containerId };
}

// ---------------------------------------------------------------- route legs ----
export async function upsertRouteLeg(shipmentId: string, leg: { sequence: number; originPortId?: string | null; destinationPortId?: string | null; mode?: string; vesselId?: string | null; voyageId?: string | null; plannedDeparture?: string | null; plannedArrival?: string | null }): Promise<MgmtResult> {
  let user; try { user = await req("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  if (!Number.isInteger(leg.sequence) || leg.sequence < 1) return { ok: false, error: "invalid_sequence" };
  const admin = getAdminSupabaseClient();
  if (!(await inTenant(admin, "shipment", shipmentId, user.tenantId))) return { ok: false, error: "not_found" };
  if (!(await inTenant(admin, "ocean_port", leg.originPortId, user.tenantId))) return { ok: false, error: "invalid_port" };
  if (!(await inTenant(admin, "ocean_port", leg.destinationPortId, user.tenantId))) return { ok: false, error: "invalid_port" };
  if (!(await inTenant(admin, "ocean_vessel", leg.vesselId, user.tenantId))) return { ok: false, error: "invalid_vessel" };
  if (!(await inTenant(admin, "ocean_voyage", leg.voyageId, user.tenantId))) return { ok: false, error: "invalid_voyage" };
  const chrono = validateVoyageChronology({ plannedDeparture: leg.plannedDeparture, plannedArrival: leg.plannedArrival });
  if (!chrono.ok) return { ok: false, error: chrono.reason };
  const mode = ["SEA", "ROAD", "RAIL", "TRANSSHIPMENT"].includes(leg.mode ?? "") ? leg.mode : "SEA";
  const { error } = await admin.from("ocean_route_leg").upsert({
    tenant_id: user.tenantId, shipment_id: shipmentId, sequence: leg.sequence, origin_port_id: leg.originPortId ?? null, destination_port_id: leg.destinationPortId ?? null,
    mode, vessel_id: leg.vesselId ?? null, voyage_id: leg.voyageId ?? null, planned_departure: leg.plannedDeparture ?? null, planned_arrival: leg.plannedArrival ?? null, source: "MANUAL",
  }, { onConflict: "tenant_id,shipment_id,sequence" });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_ROUTE_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId, after: { sequence: leg.sequence } });
  revalidatePath(`/shipping/shipments/${shipmentId}`); return { ok: true };
}
export async function deleteRouteLeg(shipmentId: string, sequence: number): Promise<MgmtResult> {
  let user; try { user = await req("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  const admin = getAdminSupabaseClient();
  const { error } = await admin.from("ocean_route_leg").delete().eq("tenant_id", user.tenantId).eq("shipment_id", shipmentId).eq("sequence", sequence);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_ROUTE_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId, after: { removedSequence: sequence } });
  revalidatePath(`/shipping/shipments/${shipmentId}`); return { ok: true };
}

// ---------------------------------------------------------------- ETA ----
export async function updateShipmentEta(shipmentId: string, value: string, source: string): Promise<MgmtResult> {
  let user; try { user = await req("transport:update"); } catch { return { ok: false, error: "forbidden" }; }
  if (!Number.isFinite(new Date(value).getTime())) return { ok: false, error: "invalid_timestamp" };
  if (!["CARRIER", "PORT", "AIS_DERIVED", "MANUAL", "SYSTEM_ESTIMATE"].includes(source)) return { ok: false, error: "invalid_source" };
  const admin = getAdminSupabaseClient();
  const { data: s } = await admin.from("shipment").select("eta").eq("id", shipmentId).eq("tenant_id", user.tenantId).maybeSingle<{ eta: string | null }>();
  if (!s) return { ok: false, error: "not_found" };
  const conf = source === "CARRIER" ? "HIGH" : source === "SYSTEM_ESTIMATE" ? "LOW" : "MEDIUM";
  const { error } = await admin.from("shipment").update({ eta: new Date(value).toISOString(), eta_previous: s.eta, eta_source: source, eta_confidence: conf, eta_calculated_at: new Date().toISOString() }).eq("id", shipmentId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.SHIPPING_ETA_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "shipment", entityId: shipmentId, after: { source, confidence: conf } });
  revalidatePath(`/shipping/shipments/${shipmentId}`); return { ok: true, id: shipmentId };
}

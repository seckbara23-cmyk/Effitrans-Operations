"use server";

/**
 * TMS-5 — Parc & Flotte writes. SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * AUTHORITY, resolved from the repository and NOT invented: registering,
 * editing and immobilizing a vehicle is `transport:manage` — the same
 * authority that already governs every transport master-data entity (ocean
 * carriers, ports, vessels, airports, airlines, flights). Binding a vehicle to
 * a mission is `transport:assign` and lives in lib/transport/actions.ts, where
 * driver/vehicle assignment already lives. Reading is `transport:read`.
 * No new permission exists for the parc.
 *
 * Every material change is audited. Vehicle master-data changes are NOT
 * business events: that ledger is dossier-scoped (emit_business_event resolves
 * a file_id), and a vehicle is not a dossier fact.
 */
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/require-permission";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

export type FleetResult = { ok: true; id?: string } | { ok: false; error: string };

const VEHICLE_TYPES = ["CAMION", "CAMIONNETTE", "VOITURE", "TRACTEUR", "REMORQUE", "AUTRE"];
const COMPLIANCE_TYPES = ["ASSURANCE", "VISITE_TECHNIQUE", "CARTE_GRISE", "LICENCE_TRANSPORT", "VIGNETTE", "AUTRE"];
const VEHICLE_STATUSES = ["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE"];

export type VehicleInput = {
  registration: string;
  internalCode?: string | null;
  vehicleType?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  capacityKg?: number | null;
  capacityM3?: number | null;
  odometerKm?: number | null;
  notes?: string | null;
};

const text = (v: string | null | undefined, max = 120): string | null => {
  const s = (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
};
const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) || v < 0 ? null : v;

function revalidate() {
  revalidatePath("/transport/parc");
  revalidatePath("/transport");
}

/** Register a vehicle in the parc. */
export async function createVehicle(input: VehicleInput): Promise<FleetResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const registration = text(input.registration, 32);
  if (!registration) return { ok: false, error: "registration_required" };
  const vehicleType = input.vehicleType ?? "CAMION";
  if (!VEHICLE_TYPES.includes(vehicleType)) return { ok: false, error: "invalid_type" };

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("vehicle")
    .insert({
      tenant_id: user.tenantId,
      registration,
      internal_code: text(input.internalCode, 32),
      vehicle_type: vehicleType,
      make: text(input.make, 64),
      model: text(input.model, 64),
      year: input.year ?? null,
      capacity_kg: num(input.capacityKg),
      capacity_m3: num(input.capacityM3),
      odometer_km: num(input.odometerKm),
      notes: text(input.notes, 500),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "duplicate_registration" };
    return { ok: false, error: error?.message ?? "create_failed" };
  }

  await writeAudit({
    action: AuditActions.VEHICLE_CREATED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "vehicle", entityId: data.id,
    after: { registration, vehicle_type: vehicleType },
  });
  revalidate();
  return { ok: true, id: data.id };
}

/** Edit a vehicle's descriptive facts (never its status — that has its own act). */
export async function updateVehicle(id: string, input: VehicleInput): Promise<FleetResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const registration = text(input.registration, 32);
  if (!registration) return { ok: false, error: "registration_required" };
  const vehicleType = input.vehicleType ?? "CAMION";
  if (!VEHICLE_TYPES.includes(vehicleType)) return { ok: false, error: "invalid_type" };

  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("vehicle")
    .update({
      registration,
      internal_code: text(input.internalCode, 32),
      vehicle_type: vehicleType,
      make: text(input.make, 64),
      model: text(input.model, 64),
      year: input.year ?? null,
      capacity_kg: num(input.capacityKg),
      capacity_m3: num(input.capacityM3),
      odometer_km: num(input.odometerKm),
      notes: text(input.notes, 500),
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "duplicate_registration" };
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: AuditActions.VEHICLE_UPDATED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "vehicle", entityId: id,
    after: { registration, vehicle_type: vehicleType },
  });
  revalidate();
  return { ok: true, id };
}

/**
 * Declare availability. AVAILABLE / MAINTENANCE / OUT_OF_SERVICE only —
 * « En mission » is never written here: it is derived from transport_record.
 */
export async function setVehicleStatus(id: string, status: string, reason?: string | null): Promise<FleetResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!VEHICLE_STATUSES.includes(status)) return { ok: false, error: "invalid_status" };

  const supabase = getAdminSupabaseClient();
  const { data: current } = await supabase
    .from("vehicle")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{ id: string; status: string }>();
  if (!current) return { ok: false, error: "not_found" };
  if (current.status === status) return { ok: true, id };

  // Returning to service is refused while an immobilizing intervention is
  // still open — the intervention is closed first, so the two never disagree.
  if (status === "AVAILABLE") {
    const { data: open } = await supabase
      .from("vehicle_maintenance")
      .select("id")
      .eq("tenant_id", user.tenantId)
      .eq("vehicle_id", id)
      .eq("status", "OPEN")
      .eq("immobilizing", true)
      .maybeSingle();
    if (open) return { ok: false, error: "maintenance_open" };
  }

  const { error } = await supabase
    .from("vehicle")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.VEHICLE_STATUS_CHANGED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "vehicle", entityId: id,
    before: { status: current.status },
    after: { status, reason: text(reason, 300) },
  });
  revalidate();
  return { ok: true, id };
}

/** Retire (or restore) a vehicle. Never deletes: history stays readable. */
export async function setVehicleActive(id: string, isActive: boolean): Promise<FleetResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("vehicle")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.VEHICLE_UPDATED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "vehicle", entityId: id,
    after: { is_active: isActive },
  });
  revalidate();
  return { ok: true, id };
}

/**
 * TMS-5C — permanent deletion of a vehicle that NEVER SERVED.
 *
 * The retention rule, derived from what each child row actually means:
 *   * transport_record.vehicle_id — OPERATIONAL EVIDENCE that a mission used
 *     this vehicle. Any reference, current or historical, REFUSES deletion.
 *     The FK carries no ON DELETE clause, so the database refuses it too even
 *     if this check were bypassed.
 *   * vehicle_maintenance — intervention history: work performed, an
 *     immobilization, a return to service, each audited. Also evidence, so any
 *     row REFUSES deletion.
 *   * vehicle_compliance — DESCRIPTIVE master data about the asset (insurance
 *     and inspection dates). It records nothing that happened operationally and
 *     cannot exist without its vehicle, so it is removed with it (the FK's
 *     existing cascade). This is the one child whose retention differs, and it
 *     is deliberate rather than a convenience to make the delete succeed.
 *
 * A vehicle carrying protected history is never destroyed: it is retired
 * through the existing lifecycle (« Mettre hors service »), which is why this
 * action refuses instead of offering a force flag.
 */
export async function deleteVehicle(id: string, confirmation: string): Promise<FleetResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const supabase = getAdminSupabaseClient();
  const { data: vehicle } = await supabase
    .from("vehicle")
    .select("id, registration")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)          // tenant ownership, server-side
    .maybeSingle<{ id: string; registration: string }>();
  if (!vehicle) return { ok: false, error: "not_found" };

  // The confirmation is re-checked HERE: the browser never decides whether a
  // destructive operation may proceed.
  if ((confirmation ?? "").replace(/\s+/g, " ").trim().toUpperCase() !== vehicle.registration.toUpperCase()) {
    return { ok: false, error: "confirmation_mismatch" };
  }

  const { count: transportRefs } = await supabase
    .from("transport_record")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("vehicle_id", id);
  if ((transportRefs ?? 0) > 0) return { ok: false, error: "vehicle_in_use" };

  const { count: maintenanceRows } = await supabase
    .from("vehicle_maintenance")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("vehicle_id", id);
  if ((maintenanceRows ?? 0) > 0) return { ok: false, error: "vehicle_has_history" };

  const { error } = await supabase
    .from("vehicle")
    .delete()
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) {
    // 23503 = a transport_record still points here (a race against the checks
    // above). The database is the backstop; the refusal stays the same.
    if (error.code === "23503") return { ok: false, error: "vehicle_in_use" };
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: AuditActions.VEHICLE_DELETED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "vehicle", entityId: id,
    before: { registration: vehicle.registration },
  });
  revalidate();
  return { ok: true, id };
}

/** Record or renew a compliance item (dates and references only). */
export async function upsertVehicleCompliance(input: {
  vehicleId: string; typeCode: string; reference?: string | null;
  issuedOn?: string | null; expiresOn?: string | null; note?: string | null;
}): Promise<FleetResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!COMPLIANCE_TYPES.includes(input.typeCode)) return { ok: false, error: "invalid_type" };

  const supabase = getAdminSupabaseClient();
  const { data: vehicle } = await supabase
    .from("vehicle").select("id").eq("id", input.vehicleId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!vehicle) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("vehicle_compliance")
    .upsert({
      tenant_id: user.tenantId,
      vehicle_id: input.vehicleId,
      type_code: input.typeCode,
      reference: text(input.reference, 64),
      issued_on: input.issuedOn || null,
      expires_on: input.expiresOn || null,
      note: text(input.note, 300),
    }, { onConflict: "vehicle_id,type_code" });
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.VEHICLE_COMPLIANCE_RECORDED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "vehicle", entityId: input.vehicleId,
    after: { type_code: input.typeCode, expires_on: input.expiresOn ?? null },
  });
  revalidate();
  return { ok: true, id: input.vehicleId };
}

/**
 * Open an intervention. An IMMOBILIZING one also puts the vehicle in
 * MAINTENANCE, so the parc view and the assignment interlock agree instantly.
 */
export async function openVehicleMaintenance(input: {
  vehicleId: string; kind: string; description: string;
  immobilizing?: boolean; openedOn?: string | null; odometerKm?: number | null;
}): Promise<FleetResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (input.kind !== "PLANNED" && input.kind !== "UNPLANNED") return { ok: false, error: "invalid_kind" };
  const description = text(input.description, 500);
  if (!description) return { ok: false, error: "description_required" };
  const immobilizing = input.immobilizing !== false;

  const supabase = getAdminSupabaseClient();
  const { data: vehicle } = await supabase
    .from("vehicle").select("id, status").eq("id", input.vehicleId).eq("tenant_id", user.tenantId)
    .maybeSingle<{ id: string; status: string }>();
  if (!vehicle) return { ok: false, error: "not_found" };

  const { data, error } = await supabase
    .from("vehicle_maintenance")
    .insert({
      tenant_id: user.tenantId,
      vehicle_id: input.vehicleId,
      kind: input.kind,
      immobilizing,
      description,
      opened_on: input.openedOn || undefined,
      odometer_km: num(input.odometerKm),
      opened_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "maintenance_open" };
    return { ok: false, error: error?.message ?? "create_failed" };
  }

  if (immobilizing && vehicle.status === "AVAILABLE") {
    await supabase.from("vehicle").update({ status: "MAINTENANCE" })
      .eq("id", input.vehicleId).eq("tenant_id", user.tenantId);
  }

  await writeAudit({
    action: AuditActions.VEHICLE_MAINTENANCE_OPENED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "vehicle", entityId: input.vehicleId,
    after: { maintenance_id: data.id, kind: input.kind, immobilizing },
  });
  revalidate();
  return { ok: true, id: data.id };
}

/** Close an intervention and return the vehicle to service. */
export async function closeVehicleMaintenance(maintenanceId: string, resolution?: string | null): Promise<FleetResult> {
  let user;
  try { user = await assertPermission("transport:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const supabase = getAdminSupabaseClient();
  const { data: m } = await supabase
    .from("vehicle_maintenance")
    .select("id, vehicle_id, status, immobilizing")
    .eq("id", maintenanceId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{ id: string; vehicle_id: string; status: string; immobilizing: boolean }>();
  if (!m) return { ok: false, error: "not_found" };
  if (m.status !== "OPEN") return { ok: false, error: "already_closed" };

  const { error } = await supabase
    .from("vehicle_maintenance")
    .update({
      status: "CLOSED",
      closed_on: new Date().toISOString().slice(0, 10),
      resolution: text(resolution, 500),
      closed_by: user.id,
    })
    .eq("id", maintenanceId)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  // Return to service only from MAINTENANCE: a vehicle deliberately marked
  // OUT_OF_SERVICE stays out until the steward says otherwise.
  if (m.immobilizing) {
    await supabase.from("vehicle").update({ status: "AVAILABLE" })
      .eq("id", m.vehicle_id).eq("tenant_id", user.tenantId).eq("status", "MAINTENANCE");
  }

  await writeAudit({
    action: AuditActions.VEHICLE_MAINTENANCE_CLOSED,
    actorId: user.id, tenantId: user.tenantId,
    entity: "vehicle", entityId: m.vehicle_id,
    after: { maintenance_id: maintenanceId },
  });
  revalidate();
  return { ok: true, id: maintenanceId };
}

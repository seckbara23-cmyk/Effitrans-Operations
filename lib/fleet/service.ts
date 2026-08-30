/**
 * TMS-5 — Parc & Flotte reads. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Gate: `transport:read` — the SAME authority the RLS select policies require
 * and the one that governs every other transport reference-data read. The
 * admin client bypasses RLS, so the app gate is the boundary (EC-3C).
 *
 * « Affecté / En mission » is DERIVED here from live transport_record rows,
 * never stored on the vehicle: the execution machine stays the single source
 * of truth, so a fleet view can never drift from what transport actually did.
 */
import "server-only";
import { assertPermission } from "@/lib/auth/require-permission";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { classifyExpiry, type ExpiryState } from "@/lib/documents/expiry";

/** Transport states that mean the vehicle is engaged right now. */
export const ENGAGED_TRANSPORT_STATUSES = [
  "PLANNED",
  "DRIVER_ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
] as const;

export type VehicleStatus = "AVAILABLE" | "MAINTENANCE" | "OUT_OF_SERVICE";

export type ComplianceItem = {
  id: string;
  typeCode: string;
  reference: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  expiryState: ExpiryState;
};

export type MaintenanceItem = {
  id: string;
  kind: "PLANNED" | "UNPLANNED";
  status: "OPEN" | "CLOSED";
  immobilizing: boolean;
  description: string;
  openedOn: string;
  closedOn: string | null;
  resolution: string | null;
};

export type FleetVehicle = {
  id: string;
  registration: string;
  internalCode: string | null;
  vehicleType: string;
  make: string | null;
  model: string | null;
  year: number | null;
  capacityKg: number | null;
  capacityM3: number | null;
  odometerKm: number | null;
  status: VehicleStatus;
  isActive: boolean;
  /** TMS-1A — set only while retired; cleared by reactivation. */
  retiredAt: string | null;
  retiredReason: string | null;
  notes: string | null;
  /** DERIVED — a live transport references this vehicle. Never stored. */
  engaged: boolean;
  engagedFileNumbers: string[];
  compliance: ComplianceItem[];
  openMaintenance: MaintenanceItem | null;
};

export type FleetOverview = {
  /** ACTIVE vehicles only — a retired vehicle is not operational fleet. */
  total: number;
  available: number;
  engaged: number;
  maintenance: number;
  outOfService: number;
  /** TMS-1A — retired (« hors parc ») count, shown apart, never operational. */
  retired: number;
  complianceExpiring: number;
  complianceExpired: number;
};

type VehicleRow = {
  id: string; registration: string; internal_code: string | null; vehicle_type: string;
  make: string | null; model: string | null; year: number | null;
  capacity_kg: number | null; capacity_m3: number | null; odometer_km: number | null;
  status: string; is_active: boolean; notes: string | null;
  retired_at: string | null; retired_reason: string | null;
};

const VEHICLE_COLS =
  "id, registration, internal_code, vehicle_type, make, model, year, capacity_kg, capacity_m3, odometer_km, status, is_active, notes, retired_at, retired_reason";

/**
 * The whole parc, with derived engagement, compliance state and any open
 * intervention. One query per concern — never per vehicle.
 */
export async function listFleet(nowIso?: string): Promise<FleetVehicle[]> {
  const user = await assertPermission("transport:read");
  const supabase = getAdminSupabaseClient();
  const now = nowIso ?? new Date().toISOString();

  const { data: vehicles } = await supabase
    .from("vehicle")
    .select(VEHICLE_COLS)
    .eq("tenant_id", user.tenantId)
    .order("registration", { ascending: true })
    .returns<VehicleRow[]>();
  const rows = vehicles ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((v) => v.id);

  const [complianceRes, maintenanceRes, engagedRes] = await Promise.all([
    supabase
      .from("vehicle_compliance")
      .select("id, vehicle_id, type_code, reference, issued_on, expires_on")
      .eq("tenant_id", user.tenantId)
      .in("vehicle_id", ids)
      .returns<{ id: string; vehicle_id: string; type_code: string; reference: string | null; issued_on: string | null; expires_on: string | null }[]>(),
    supabase
      .from("vehicle_maintenance")
      .select("id, vehicle_id, kind, status, immobilizing, description, opened_on, closed_on, resolution")
      .eq("tenant_id", user.tenantId)
      .in("vehicle_id", ids)
      .eq("status", "OPEN")
      .returns<{ id: string; vehicle_id: string; kind: string; status: string; immobilizing: boolean; description: string; opened_on: string; closed_on: string | null; resolution: string | null }[]>(),
    supabase
      .from("transport_record")
      .select("vehicle_id, file:file_id(file_number)")
      .eq("tenant_id", user.tenantId)
      .in("vehicle_id", ids)
      .in("status", [...ENGAGED_TRANSPORT_STATUSES])
      .is("deleted_at", null)
      .returns<{ vehicle_id: string | null; file: { file_number: string } | null }[]>(),
  ]);

  const engagedBy = new Map<string, string[]>();
  for (const r of engagedRes.data ?? []) {
    if (!r.vehicle_id) continue;
    const list = engagedBy.get(r.vehicle_id) ?? [];
    if (r.file?.file_number) list.push(r.file.file_number);
    engagedBy.set(r.vehicle_id, list);
  }

  return rows.map((v) => {
    const engagedFileNumbers = engagedBy.get(v.id) ?? [];
    const open = (maintenanceRes.data ?? []).find((m) => m.vehicle_id === v.id) ?? null;
    return {
      id: v.id,
      registration: v.registration,
      internalCode: v.internal_code,
      vehicleType: v.vehicle_type,
      make: v.make,
      model: v.model,
      year: v.year,
      capacityKg: v.capacity_kg,
      capacityM3: v.capacity_m3,
      odometerKm: v.odometer_km,
      status: v.status as VehicleStatus,
      isActive: v.is_active,
      retiredAt: v.retired_at,
      retiredReason: v.retired_reason,
      notes: v.notes,
      engaged: engagedBy.has(v.id),
      engagedFileNumbers,
      compliance: (complianceRes.data ?? [])
        .filter((c) => c.vehicle_id === v.id)
        .map((c) => ({
          id: c.id,
          typeCode: c.type_code,
          reference: c.reference,
          issuedOn: c.issued_on,
          expiresOn: c.expires_on,
          expiryState: classifyExpiry(c.expires_on, new Date(now)),
        }))
        .sort((a, b) => a.typeCode.localeCompare(b.typeCode)),
      openMaintenance: open
        ? {
            id: open.id,
            kind: open.kind as "PLANNED" | "UNPLANNED",
            status: "OPEN",
            immobilizing: open.immobilizing,
            description: open.description,
            openedOn: open.opened_on,
            closedOn: null,
            resolution: null,
          }
        : null,
    };
  });
}

/** Counts for the Transport management overview. Derived, never stored. */
export function summarizeFleet(fleet: FleetVehicle[]): FleetOverview {
  const active = fleet.filter((v) => v.isActive);
  let complianceExpiring = 0;
  let complianceExpired = 0;
  for (const v of active) {
    for (const c of v.compliance) {
      if (c.expiryState === "expiring") complianceExpiring += 1;
      if (c.expiryState === "expired") complianceExpired += 1;
    }
  }
  return {
    total: active.length,
    // A vehicle engaged on a live transport is reported as engaged, not as
    // available — the two are mutually exclusive in the display.
    available: active.filter((v) => v.status === "AVAILABLE" && !v.engaged).length,
    engaged: active.filter((v) => v.engaged).length,
    maintenance: active.filter((v) => v.status === "MAINTENANCE").length,
    outOfService: active.filter((v) => v.status === "OUT_OF_SERVICE").length,
    retired: fleet.length - active.length,
    complianceExpiring,
    complianceExpired,
  };
}

/**
 * Vehicles bindable to a transport RIGHT NOW: active, AVAILABLE, and not
 * already engaged elsewhere. The database refuses the first two independently
 * (the interlock trigger) — this read exists so the operator is never offered
 * a choice the server will reject.
 */
export async function listAssignableVehicles(): Promise<{ id: string; label: string }[]> {
  const fleet = await listFleet();
  return fleet
    .filter((v) => v.isActive && v.status === "AVAILABLE" && !v.engaged)
    .map((v) => ({
      id: v.id,
      label: v.internalCode ? `${v.registration} — ${v.internalCode}` : v.registration,
    }));
}

/** Intervention history for one vehicle (most recent first). */
export async function listVehicleMaintenance(vehicleId: string): Promise<MaintenanceItem[]> {
  const user = await assertPermission("transport:read");
  const supabase = getAdminSupabaseClient();
  const { data } = await supabase
    .from("vehicle_maintenance")
    .select("id, kind, status, immobilizing, description, opened_on, closed_on, resolution")
    .eq("tenant_id", user.tenantId)
    .eq("vehicle_id", vehicleId)
    .order("opened_on", { ascending: false })
    .limit(50)
    .returns<{ id: string; kind: string; status: string; immobilizing: boolean; description: string; opened_on: string; closed_on: string | null; resolution: string | null }[]>();
  return (data ?? []).map((m) => ({
    id: m.id,
    kind: m.kind as "PLANNED" | "UNPLANNED",
    status: m.status as "OPEN" | "CLOSED",
    immobilizing: m.immobilizing,
    description: m.description,
    openedOn: m.opened_on,
    closedOn: m.closed_on,
    resolution: m.resolution,
  }));
}

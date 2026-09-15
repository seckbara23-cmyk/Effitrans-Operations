/**
 * Vehicle identity (TRN-VEHICLE-01) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * One transport names its vehicle in one of two ways, and they are not the
 * same fact:
 *
 *   * `transport_record.vehicle_id` → `vehicle.registration` — the AUTHORITATIVE
 *     Effitrans fleet assignment (TMS-5). The parc knows the truck; the
 *     transport only points at it.
 *   * `transport_record.vehicle_plate` — free text. How an external, hired or
 *     legacy vehicle is recorded (the TMS-6 boundary); it stays exactly that.
 *
 * Until this module, most readers took the free text as "the vehicle" and so a
 * fleet-executed mission — whose plate is, correctly, NULL — read as having no
 * vehicle at all: the chauffeur saw « Véhicule : — », the Ordre de transport
 * refused « Véhicule », the pickup gate said `no_vehicle_plate`. The Transport
 * Officer's own panel, which resolves the fleet row, showed the truck fine.
 *
 * THE RULE, applied by every reader that needs to name or count a vehicle:
 * the fleet registration when a fleet vehicle is bound, the free-text plate
 * otherwise, nothing when neither exists. Nothing is copied from one column to
 * the other, and the operator is never asked to retype what the parc knows.
 */

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

export type VehicleIdentitySource = {
  /** `vehicle.registration`, reached through `transport_record.vehicle_id`. */
  registration?: string | null;
  /** `transport_record.vehicle_plate` — the external/hired/legacy free text. */
  plate?: string | null;
};

/**
 * The string that names the vehicle: the bound fleet vehicle's registration
 * first, the free-text plate as the fallback, `null` when there is neither.
 * A whitespace-only value in either place counts as absent.
 */
export function resolveVehicleIdentity(src: VehicleIdentitySource): string | null {
  return clean(src.registration) ?? clean(src.plate);
}

export type VehicleAssignmentSource = {
  /** `transport_record.vehicle_id` — a bound fleet vehicle IS an assignment. */
  vehicleId?: string | null;
  /** `transport_record.vehicle_plate` — a real plate string is one too. */
  plate?: string | null;
};

/**
 * Whether a vehicle is assigned at all — the pickup gate's question. Mirrors
 * `driver_assigned` exactly: the authoritative link OR the legacy text, never
 * the text alone.
 */
export function isVehicleAssigned(src: VehicleAssignmentSource): boolean {
  return clean(src.vehicleId) !== null || clean(src.plate) !== null;
}

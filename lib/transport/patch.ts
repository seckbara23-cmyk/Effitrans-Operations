/**
 * Transport partial-patch contract (Phase WES-1A) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * The WES Audit found `updateTransport`/`assignTransport` writing every field
 * they own as `input.x?.trim() || null`, so a caller that supplied a PARTIAL
 * input silently nulled everything it omitted. That is a full-overwrite
 * contract wearing the shape of a patch, and it is how transport planning data
 * disappeared during UAT.
 *
 * THE CONTRACT (WES-1A, deliberately conservative):
 *
 *   field omitted (`undefined`)   -> PRESERVE  (not written at all)
 *   field `null`                  -> PRESERVE  (an absent form value is not consent)
 *   field `""` / whitespace       -> PRESERVE  (an empty input is not consent)
 *   field with text               -> SET (trimmed)
 *   field listed in `clearFields` -> CLEAR (the ONLY way to write null)
 *
 * The ratified rule is *"do not infer clear from an omitted, undefined, absent
 * or unrelated form field"*: erasing data requires the caller to name the field
 * explicitly. A UI that wants blanking-to-clear semantics computes `clearFields`
 * itself, from a real comparison against the value it loaded.
 *
 * Booleans (customs_override) are not nullable: `undefined` preserves, a boolean
 * sets. They are never clearable.
 */

/** Planning fields owned by `updateTransport`. */
export const TRANSPORT_PLANNING_FIELDS = [
  "pickupLocation",
  "deliveryLocation",
  "pickupPlanned",
  "deliveryPlanned",
  "transportCompany",
  "deliveryReference",
  "notes",
] as const;

/** Driver/vehicle fields owned by `assignTransport`. */
export const TRANSPORT_ASSIGNMENT_FIELDS = [
  "driverName",
  "driverPhone",
  "vehiclePlate",
  // TMS-5 — the INTERNAL fleet vehicle. vehiclePlate stays beside it: an
  // external/hired vehicle is still recorded as free text (TMS-6 boundary).
  "vehicleId",
  "trailerOrContainer",
] as const;

export type TransportPlanningField = (typeof TRANSPORT_PLANNING_FIELDS)[number];
export type TransportAssignmentField = (typeof TRANSPORT_ASSIGNMENT_FIELDS)[number];
export type TransportPatchField = TransportPlanningField | TransportAssignmentField;

/** Input key -> database column. The single mapping; nothing else spells these. */
export const TRANSPORT_COLUMN: Readonly<Record<TransportPatchField, string>> = {
  pickupLocation: "pickup_location",
  deliveryLocation: "delivery_location",
  pickupPlanned: "pickup_planned",
  deliveryPlanned: "delivery_planned",
  transportCompany: "transport_company",
  deliveryReference: "delivery_reference",
  notes: "notes",
  driverName: "driver_name",
  driverPhone: "driver_phone",
  vehiclePlate: "vehicle_plate",
  vehicleId: "vehicle_id",
  trailerOrContainer: "trailer_or_container",
};

export type TransportPatchInput = Partial<Record<TransportPatchField, string | null | undefined>>;

/** Every clear target must belong to the action that was called. */
export function clearFieldsAreValid(
  clearFields: readonly string[] | undefined,
  allowed: readonly TransportPatchField[],
): boolean {
  if (!clearFields) return true;
  return clearFields.every((f) => (allowed as readonly string[]).includes(f));
}

/**
 * Build the database patch for the fields this action owns. Returns ONLY the
 * columns that must actually be written — an omitted field never appears, so it
 * cannot be overwritten.
 */
export function buildTransportPatch(
  input: TransportPatchInput,
  allowed: readonly TransportPatchField[],
  clearFields?: readonly string[],
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};

  for (const field of allowed) {
    const raw = input[field];
    if (raw === undefined || raw === null) continue; // omitted -> preserve
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue; // empty input -> preserve, never clear
    patch[TRANSPORT_COLUMN[field]] = trimmed;
  }

  // Explicit clears win: naming a field is the only consent to erase it.
  for (const field of clearFields ?? []) {
    if (!(allowed as readonly string[]).includes(field)) continue;
    patch[TRANSPORT_COLUMN[field as TransportPatchField]] = null;
  }

  return patch;
}

/** True when the patch would write nothing — the action can return early, unaudited. */
export function isEmptyPatch(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length === 0;
}

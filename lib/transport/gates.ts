/**
 * Transport validation gates (Phase 1.10) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Cross-module guards: the customs dependency for PICKED_UP and the POD
 * dependency for POD_RECEIVED. Kept free of I/O so they are unit-testable; the
 * service/actions feed them the data (customs status, file type, approved docs).
 */

/**
 * Can goods be PICKED_UP? For IMP/EXP the customs record must be RELEASED unless
 * customs is not required / absent, or a manager has set customs_override.
 * TRP/HND are never gated (no customs leg). Goods can't leave the customs zone
 * before BAE, so this is the physical hard gate.
 */
export function canPickup(
  fileType: string,
  customs: { required: boolean; status: string } | null,
  customsOverride: boolean,
): boolean {
  if (fileType !== "IMP" && fileType !== "EXP") return true;
  if (customsOverride) return true;
  if (!customs || !customs.required) return true;
  return customs.status === "RELEASED";
}

/** POD_RECEIVED requires an APPROVED Delivery Note / POD document on the dossier. */
export function canReceivePod(approvedDocTypeCodes: string[]): boolean {
  return approvedDocTypeCodes.includes("DELIVERY_NOTE");
}

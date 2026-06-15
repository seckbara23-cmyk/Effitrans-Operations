/**
 * Customs validation gates (Phase 1.9) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * The cross-checks that guard customs transitions and the dossier-close rule.
 * Kept free of I/O so they are fully unit-testable; the service/actions feed
 * them the data (missing docs, BAE ref, customs status).
 */

/**
 * Which gating document types are actually required for this shipment, applying
 * the BL/AWB-by-mode rule: SEA needs BL (not AWB), AIR needs AWB (not BL), any
 * other / unknown mode requires neither transport title.
 */
export function requiredCustomsDocCodes(gatingCodes: string[], mode: string | null): string[] {
  const drop = new Set<string>();
  if (mode === "SEA") drop.add("AIRWAY_BILL");
  else if (mode === "AIR") drop.add("BILL_OF_LADING");
  else {
    drop.add("AIRWAY_BILL");
    drop.add("BILL_OF_LADING");
  }
  return gatingCodes.filter((c) => !drop.has(c));
}

/** A declaration can be filed only when no prerequisite document is missing. */
export function canDeclare(missingCodes: string[]): boolean {
  return missingCodes.length === 0;
}

/** Release requires a BAE / release reference. */
export function canRelease(input: { baeReference?: string | null }): boolean {
  return Boolean(input.baeReference && input.baeReference.trim());
}

/**
 * Dossier-close guard: an IMP/EXP file with a REQUIRED customs record that isn't
 * RELEASED/CANCELLED cannot be closed. No record, non-IMP/EXP, or required=false
 * => allowed (the required flag is the escape hatch).
 */
export function canCloseFile(
  fileType: string,
  customs: { required: boolean; status: string } | null,
): boolean {
  if (fileType !== "IMP" && fileType !== "EXP") return true;
  if (!customs || !customs.required) return true;
  return customs.status === "RELEASED" || customs.status === "CANCELLED";
}

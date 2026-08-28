/**
 * D1 — the canonical declaration-type vocabulary and CDP coefficients.
 * ---------------------------------------------------------------------------
 * RATIFIED 2026-08-28. Exactly four types. « DPE » is not one of them and never
 * was: some declarants historically wrote DPE instead of DEP and the workbook
 * tolerated both spellings to protect its VLOOKUP. The platform does not
 * reproduce the tolerance — it resolves it. DEP carries the coefficient the
 * workbook gave both spellings, 1,30.
 *
 * `normalizeDeclarationType` is the ONLY door through which the historical
 * label may enter, and it exists for the import boundary alone (the migration
 * 101 idiom: source label preserved, normalized value derived). Production
 * capture uses `DECLARATION_TYPES` and a database CHECK that knows nothing of
 * DPE — a mis-spelling must be impossible to store, not merely discouraged.
 *
 * Contract: ICTD-D05 (formula-contract-register.md). Parity: F-ICTD-05 and the
 * repurposed F-ICTD-06 — a historical « DPE » row must compute exactly what a
 * DEP row computes, 4,94.
 */

export const DECLARATION_TYPES = ["SIMPLE", "APE", "DEP", "OG"] as const;
export type DeclarationType = (typeof DECLARATION_TYPES)[number];

/** CDP — coefficient type de déclaration (ICTD-D05, ratified values). */
export const CDP_COEFFICIENTS: Record<DeclarationType, number> = {
  SIMPLE: 1.0,
  APE: 1.4,
  DEP: 1.3,
  OG: 1.5,
};

export function isDeclarationType(value: string): value is DeclarationType {
  return (DECLARATION_TYPES as readonly string[]).includes(value);
}

/**
 * Import-boundary normalization. Accepts the four canonical labels in any
 * casing/spacing, plus the single ratified historical alias DPE → DEP.
 * Anything else is null — an import must surface it, never guess.
 */
export function normalizeDeclarationType(sourceLabel: string): DeclarationType | null {
  const label = sourceLabel.trim().toUpperCase();
  if (label === "DPE") return "DEP"; // D1 — historical spelling of DEP, 1,30
  return isDeclarationType(label) ? label : null;
}

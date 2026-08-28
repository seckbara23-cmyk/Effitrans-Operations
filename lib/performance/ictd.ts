/**
 * ICTD per-dossier computation — contracts ICTD-D04..D10, frozen rounding order.
 * ---------------------------------------------------------------------------
 * `ICTD = ROUND( ROUND(UD + UF·NF + UA·NPSH·CCT, 2) × CDP + U_DPI + U_TE + U_COT, 2 )`
 *
 * The intermediate ROUND on the bloc principal is not cosmetic: Phase 0 proved
 * cent-level differences without it, and the rounding ORDER was ratified as
 * written. Blank rules are the workbook's own: NF/NPSH empty coerce to 0
 * (`N()`), while a missing CDP or DPI makes the dossier score BLANK (null),
 * never zero — an unscorable dossier must be visible as unscorable.
 *
 * Parity: F-ICTD-01 (12,34 — the methodology §5.4 example), F-ICTD-02..07.
 */
import { CDP_COEFFICIENTS, type DeclarationType } from "./declaration-type";

/** Base units — PARAMETRES B8/B9/B10, ratified §5.2. */
export const UD = 1.0; // unité dossier
export const UF = 0.5; // unité par facture
export const UA = 0.3; // unité par position SH

/** CCT — coefficient classement tarifaire (ICTD-D04). */
export const CCT_COEFFICIENTS = { CLIENT: 0.6, EFFITRANS: 1.2 } as const;
export type TariffClassificationOrigin = keyof typeof CCT_COEFFICIENTS;

/** U_DPI — DPI prise en charge (ICTD-D06). */
export const DPI_UNITS = {
  SANS_DPI: 0,
  CLIENT_EXPEDITION: 0,
  CLIENT_GLOBALE: 0.5,
  EFFITRANS: 1.0,
} as const;
export type DpiRegime = keyof typeof DPI_UNITS;

/** U_TE — titre d'exonération (ICTD-D07): 0,80 when EFFITRANS prepared it. */
export const TE_UNIT = 0.8;
export const EXEMPTION_TITLE_ORIGINS = ["SANS_OBJET", "CLIENT", "EFFITRANS"] as const;
export type ExemptionTitleOrigin = (typeof EXEMPTION_TITLE_ORIGINS)[number];

/** U_COT — 1,00 per cotation (ICTD-D08). */
export const COT_UNIT = 1.0;

/** Excel ROUND (half away from zero), 2 decimals. */
export function round2(x: number): number {
  return Math.sign(x) * Math.round((Math.abs(x) + Number.EPSILON) * 100) / 100;
}

export type IctdDossierInput = {
  /** NF — nombre de factures fournisseur; empty coerces to 0 (N()). */
  invoiceCount: number | null;
  /** NPSH — nombre de positions SH; empty coerces to 0 (N()). */
  shPositionCount: number | null;
  /** L — origine du classement tarifaire. */
  tariffOrigin: TariffClassificationOrigin;
  /** N — type de déclaration; missing ⇒ the dossier is unscorable (blank). */
  declarationType: DeclarationType | null;
  /** AA — DPI prise en charge; missing ⇒ the dossier is unscorable (blank). */
  dpiRegime: DpiRegime | null;
  /** K — titre d'exonération. */
  exemptionTitleOrigin: ExemptionTitleOrigin;
  /** W — nombre de cotations; empty counts 0. */
  cotationCount: number | null;
};

/**
 * ICTD-D10. Returns null (blank) when CDP or U_DPI is unresolvable — the
 * workbook's `IF(OR(U_DPI="",CDP=""),"", …)`.
 */
export function computeIctdDossier(input: IctdDossierInput): number | null {
  if (input.declarationType === null || input.dpiRegime === null) return null;

  const nf = input.invoiceCount ?? 0;
  const npsh = input.shPositionCount ?? 0;
  const cct = CCT_COEFFICIENTS[input.tariffOrigin];
  const cdp = CDP_COEFFICIENTS[input.declarationType];
  const uDpi = DPI_UNITS[input.dpiRegime];
  const uTe = input.exemptionTitleOrigin === "EFFITRANS" ? TE_UNIT : 0;
  const uCot = (input.cotationCount ?? 0) * COT_UNIT;

  const bloc = round2(UD + UF * nf + UA * npsh * cct); // ICTD-D09 — rounded FIRST
  return round2(bloc * cdp + uDpi + uTe + uCot); // ICTD-D10
}

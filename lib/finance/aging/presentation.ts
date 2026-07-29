/**
 * Aging Balance presentation helpers. PURE. Client + server safe.
 * ---------------------------------------------------------------------------
 * Formatting and labelling ONLY. Every number here already came out of the
 * engine; nothing in this file adds, filters or re-aggregates a figure. The rule
 * the phase turns on — no financial calculation inside a React component — is
 * easier to keep when the components' only alternative is a formatter.
 *
 * The one thing that looks like computation is `filterRows`, which SELECTS rows
 * for display. It never recomputes a total: the dashboard, the client ranking
 * and the charts always describe the whole report, and the raw-data tab states
 * how many of how many rows it is showing.
 */
import type { AgingRow, AverageDelayPopulation } from "./types";
import type { BucketKey, RiskKey } from "./buckets";

// ---------------------------------------------------------------------------
// Money and numbers — French conventions, XOF has no minor unit in practice
// ---------------------------------------------------------------------------

/**
 * Minor units → « 1 234 567 FCFA ».
 *
 * XOF is a zero-decimal currency in practice, so centimes are not displayed;
 * they are still carried exactly in the engine, which is why the rounding
 * happens HERE, at the presentation boundary, and never in a total.
 */
export function formatAmount(minorUnits: number, currency = "XOF"): string {
  const major = minorUnits / 100;
  const zeroDecimal = currency === "XOF" || currency === "XAF";
  const body = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  }).format(major);
  return `${body} ${currency === "XOF" ? "FCFA" : currency}`;
}

/** Compact form for chart labels and tight cards: « 1,2 M » / « 845 k ». */
export function formatAmountCompact(minorUnits: number, currency = "XOF"): string {
  const major = Math.abs(minorUnits) / 100;
  const sign = minorUnits < 0 ? "-" : "";
  const unit = currency === "XOF" ? "FCFA" : currency;
  if (major >= 1_000_000) return `${sign}${(major / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M ${unit}`;
  if (major >= 1_000) return `${sign}${Math.round(major / 1_000).toLocaleString("fr-FR")} k ${unit}`;
  return `${sign}${Math.round(major).toLocaleString("fr-FR")} ${unit}`;
}

export function formatInteger(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

/** Basis points → « 23,9 % ». */
export function formatShare(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** Signed day count → « 45 jours » / « 12 jours d'avance » for a not-yet-due row. */
export function formatDays(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return `${formatInteger(-days)} j d'avance`;
  if (days === 0) return "Échéance du jour";
  return `${formatInteger(days)} j`;
}

/** ISO date → « 12/06/2026 », the workbook's short form. */
export function formatDateFr(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** ISO date → « 12 juin 2026 », the workbook's long title form. */
const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
export function formatDateLongFr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_FR[m - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// Risk presentation
// ---------------------------------------------------------------------------

/** Tailwind classes per risk level, matching the workbook's colour semantics. */
export const RISK_CHIP_CLASS: Record<RiskKey, string> = {
  NON_ECHU: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  FAIBLE: "bg-lime-50 text-lime-700 ring-lime-200",
  MODERE: "bg-amber-50 text-amber-800 ring-amber-200",
  ELEVE: "bg-orange-50 text-orange-700 ring-orange-200",
  CRITIQUE: "bg-red-50 text-red-700 ring-red-200",
};

/** Bar/segment fill per bucket — the workbook's green → red progression. */
export const BUCKET_FILL: Record<BucketKey, string> = {
  NON_ECHU: "#70AD47",
  D1_30: "#92D050",
  D31_60: "#FFC000",
  D61_90: "#F0A000",
  D91_180: "#FF4500",
  D181_365: "#E03A00",
  OVER_365: "#C00000",
};

// ---------------------------------------------------------------------------
// Q-04 disclosure
// ---------------------------------------------------------------------------

/**
 * How « Retard moyen » was computed, in words.
 *
 * The population is an unresolved Finance decision (Q-04): the reference
 * workbook's KPI cell was blanked by anonymisation, so it cannot be recovered
 * from the file. The engine takes it as an input and the UI states which one was
 * used — a figure whose definition is invisible is a figure nobody can check.
 */
export const AVERAGE_DELAY_NOTE: Record<AverageDelayPopulation, string> = {
  ALL_ROWS:
    "Moyenne calculée sur TOUTES les factures en cours, y compris celles non échues "
    + "(dont le retard est négatif et abaisse donc la moyenne).",
  OVERDUE_ONLY:
    "Moyenne calculée uniquement sur les factures effectivement en retard "
    + "(au moins 1 jour). Les factures non échues sont exclues.",
};

/** Why a receivable is not in the aged population, in French. */
export const EXCLUSION_LABEL_FR: Record<string, string> = {
  DRAFT: "Brouillon — non encore émise",
  NOT_YET_ISSUED: "Émise après la date d'arrêté",
  CANCELLED: "Annulée",
  SETTLED: "Soldée",
  ZERO_BALANCE: "Solde nul",
  MISSING_DUE_DATE: "Sans échéance — non vieillissable",
  FOREIGN_CURRENCY: "Devise différente de la devise du rapport",
};

// ---------------------------------------------------------------------------
// Display filtering (selection, never recomputation)
// ---------------------------------------------------------------------------

export type RowFilters = {
  search?: string;
  clientId?: string;
  bucket?: BucketKey | "";
  risk?: RiskKey | "";
  provenance?: string;
  disputedOnly?: boolean;
};

export const EMPTY_FILTERS: RowFilters = {};

export function hasActiveFilters(f: RowFilters): boolean {
  return Boolean(
    (f.search && f.search.trim()) || f.clientId || f.bucket || f.risk || f.provenance || f.disputedOnly,
  );
}

/**
 * Narrow the rows SHOWN in Données Brutes.
 *
 * Selection only. The report's totals, buckets, client ranking and charts are
 * computed from the full population and are unaffected — the table reports
 * "N sur M" so a filtered view can never be mistaken for a smaller portfolio.
 */
export function filterRows(rows: readonly AgingRow[], f: RowFilters): AgingRow[] {
  const q = (f.search ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.clientId && r.clientId !== f.clientId) return false;
    if (f.bucket && r.bucket !== f.bucket) return false;
    if (f.risk && r.risk !== f.risk) return false;
    if (f.provenance && (r.source ?? "PLATFORM_NATIVE") !== f.provenance) return false;
    if (f.disputedOnly && !r.disputed) return false;
    if (q) {
      const hay = [
        r.invoiceNumber,
        r.clientName,
        r.dossierReference ?? "",
        r.externalDossierReference ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export const PROVENANCE_LABEL_FR: Record<string, string> = {
  PLATFORM_NATIVE: "Plateforme",
  OPENING_IMPORT: "Reprise historique",
};

/** The dossier a row should display: the platform one, else the preserved legacy one. */
export function dossierLabel(row: AgingRow): { text: string; legacy: boolean } {
  if (row.dossierReference) return { text: row.dossierReference, legacy: false };
  if (row.externalDossierReference) return { text: row.externalDossierReference, legacy: true };
  return { text: "—", legacy: false };
}

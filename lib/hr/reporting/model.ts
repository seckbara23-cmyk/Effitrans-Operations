/**
 * HR-9A — reporting vocabulary and the PRIVACY FLOOR. PURE (no server-only
 * import): the workspace is a client component and must be able to render
 * these labels and read a masked row. Readers live in ../reporting.ts.
 *
 * RQ-9.2, ratified: the floor exists so that an aggregate cannot re-identify
 * an employee to someone who cannot already see them.
 *
 *   ROW_HOLDER (hr:read — the HR desk)  sees ACTUAL totals, always. Hiding a
 *                                        number they could obtain by counting
 *                                        the registry protects nobody.
 *   AGGREGATE_ONLY (hr:reports:read
 *   without row access — the executive) sees headline totals, and BREAKDOWN
 *                                        rows below the floor are masked.
 *
 * The floor therefore applies to GROUPED rows, never to an organisation-wide
 * total: « 3 employés » identifies no one, « 1 employé au service X » can.
 */

/** Ratified floor: a breakdown group smaller than this is masked. */
export const K_ANONYMITY_FLOOR = 5;

export type ReportViewerTier = "ROW_HOLDER" | "AGGREGATE_ONLY";

/**
 * The tier is decided by ROW ACCESS, not by seniority: whoever may read the
 * employee rows may read any count of them.
 */
export function reportViewerTier(permissions: readonly string[]): ReportViewerTier {
  return permissions.includes("hr:read") ? "ROW_HOLDER" : "AGGREGATE_ONLY";
}

export type BreakdownRow = { label: string; count: number };
/** A row whose count was withheld by the floor — masked, never dropped. */
export type PresentedRow = { label: string; count: number | null; masked: boolean };

/**
 * Apply the floor to ONE breakdown. Masked rows keep their label and their
 * place: the reader learns that a group exists and that it is too small to
 * disclose, which is honest, rather than silently vanishing from the table.
 */
export function applyPrivacyFloor(
  rows: readonly BreakdownRow[], tier: ReportViewerTier,
): PresentedRow[] {
  return rows.map((r) =>
    tier === "ROW_HOLDER" || r.count >= K_ANONYMITY_FLOOR
      ? { label: r.label, count: r.count, masked: false }
      : { label: r.label, count: null, masked: true });
}

/** How many rows a given tier would see masked — for the honest footnote. */
export function maskedCount(rows: readonly BreakdownRow[], tier: ReportViewerTier): number {
  return applyPrivacyFloor(rows, tier).filter((r) => r.masked).length;
}

export const MASKED_LABEL_FR = "masqué";

// ---------------------------------------------------------------- period

/** An inclusive date window, ISO `YYYY-MM-DD`. */
export type ReportPeriod = { from: string; to: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE.test(v);
}

/**
 * A period from user input, or the current month when absent/invalid. Reversed
 * bounds are swapped rather than rejected — the user meant a window.
 */
export function resolvePeriod(from: unknown, to: unknown, today: string): ReportPeriod {
  const monthStart = `${today.slice(0, 7)}-01`;
  const a = isIsoDate(from) ? from : monthStart;
  const b = isIsoDate(to) ? to : today;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

// ---------------------------------------------------------------- vocabulary

export const EMPLOYEE_STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon", ACTIVE: "Actif", SUSPENDED: "Suspendu",
  TERMINATED: "Départ", ARCHIVED: "Archivé",
};

/**
 * The indicators HR-9 v1 publishes. Deliberately absent, and NOT to be added
 * without a ratification: any turnover RATE (RQ-9.3 — the numerator,
 * denominator and period convention are unratified), any absence rate (no
 * schedule model exists — HR-7 Q9), any monetary figure (DEC-B63), any
 * grouping of the free-text departure motive (RQ-8.1 unresolved).
 */
export const HR9_DEFERRED_INDICATORS = [
  "taux de rotation",
  "taux d'absentéisme",
  "motifs de départ groupés",
] as const;

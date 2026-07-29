/**
 * Aging bucket schemes — a REGISTRY, not a hard-coded ladder. PURE.
 * ---------------------------------------------------------------------------
 * The seven-bucket scheme below is the Finance Manager's workbook, ratified
 * 2026-07-29 and verified empirically against all 430 rows of the reference
 * report (every `Jours retard → Tranche → Risque` triple agreed, no exceptions).
 *
 * It lives here as DATA so a second scheme can be added without touching the
 * engine. That matters concretely: lib/collections/aging.ts already runs a
 * coarser 5-bucket scheme for the collections queue, and migrating that queue is
 * a deliberate future decision — not something an aging-report change should do
 * to COLLECTIONS_OFFICER by accident.
 *
 * ===========================================================================
 * TWO LABEL SETS, ONE CLASSIFICATION
 * ===========================================================================
 * The workbook's data tabs print `Modéré`; its dashboard prints `🟠 Modéré`.
 * That is not an inconsistency to tidy away — ratified as an intentional
 * presentation variant. Both labels hang off the same risk key, so no renderer
 * can drift into inventing a third vocabulary.
 */

export const BUCKET_SCHEME_KEY = "AGING_BALANCE_V1" as const;
export type BucketSchemeKey = typeof BUCKET_SCHEME_KEY;

export const BUCKET_KEYS = [
  "NON_ECHU",
  "D1_30",
  "D31_60",
  "D61_90",
  "D91_180",
  "D181_365",
  "OVER_365",
] as const;
export type BucketKey = (typeof BUCKET_KEYS)[number];

export const RISK_KEYS = ["NON_ECHU", "FAIBLE", "MODERE", "ELEVE", "CRITIQUE"] as const;
export type RiskKey = (typeof RISK_KEYS)[number];

/** Plain labels — Données Brutes column « Risque », Analyse Clients « Niveau risque ». */
export const RISK_LABEL_FR: Record<RiskKey, string> = {
  NON_ECHU: "Non échu",
  FAIBLE: "Faible",
  MODERE: "Modéré",
  ELEVE: "Élevé",
  CRITIQUE: "Critique",
};

/** Dashboard labels — Tableau de Bord column « Niveau de risque ». */
export const RISK_LABEL_DASHBOARD_FR: Record<RiskKey, string> = {
  NON_ECHU: "✅ Sain",
  FAIBLE: "🟡 Faible",
  MODERE: "🟠 Modéré",
  ELEVE: "🔴 Élevé",
  CRITIQUE: "⛔ Critique",
};

export type BucketDefinition = {
  key: BucketKey;
  /** Exact workbook label — « Tranche » / « Tranche d'ancienneté ». */
  labelFr: string;
  risk: RiskKey;
  /** Inclusive lower bound in days overdue; null = unbounded below. */
  minDays: number | null;
  /** Inclusive upper bound; null = unbounded above. */
  maxDays: number | null;
};

/**
 * The scheme, in render order. Bounds are inclusive on both sides and the seven
 * ranges are contiguous and exhaustive over the integers, so classification is
 * total: every possible day count lands in exactly one bucket.
 *
 * `NON_ECHU` absorbs d ≤ 0 — an invoice due TODAY is not overdue (ratified; the
 * client still has the day to pay), and a future due date is likewise « Non échu »
 * with its negative day count preserved for display.
 */
export const AGING_BALANCE_V1: readonly BucketDefinition[] = [
  { key: "NON_ECHU", labelFr: "Non échu (≤ 0 j)", risk: "NON_ECHU", minDays: null, maxDays: 0 },
  { key: "D1_30", labelFr: "1 – 30 jours", risk: "FAIBLE", minDays: 1, maxDays: 30 },
  { key: "D31_60", labelFr: "31 – 60 jours", risk: "MODERE", minDays: 31, maxDays: 60 },
  { key: "D61_90", labelFr: "61 – 90 jours", risk: "MODERE", minDays: 61, maxDays: 90 },
  { key: "D91_180", labelFr: "91 – 180 jours", risk: "ELEVE", minDays: 91, maxDays: 180 },
  { key: "D181_365", labelFr: "181 – 365 jours", risk: "ELEVE", minDays: 181, maxDays: 365 },
  { key: "OVER_365", labelFr: "> 365 jours", risk: "CRITIQUE", minDays: 366, maxDays: null },
];

const SCHEMES: Record<BucketSchemeKey, readonly BucketDefinition[]> = {
  AGING_BALANCE_V1,
};

export function bucketScheme(key: BucketSchemeKey = BUCKET_SCHEME_KEY): readonly BucketDefinition[] {
  return SCHEMES[key];
}

/** The bucket a day count falls into. Total over the integers — never returns undefined. */
export function classifyDays(
  daysOverdue: number,
  scheme: readonly BucketDefinition[] = AGING_BALANCE_V1,
): BucketDefinition {
  for (const b of scheme) {
    const aboveMin = b.minDays === null || daysOverdue >= b.minDays;
    const belowMax = b.maxDays === null || daysOverdue <= b.maxDays;
    if (aboveMin && belowMax) return b;
  }
  // Unreachable for a contiguous scheme; a registry misconfiguration must be loud.
  throw new Error(`[aging/buckets] no bucket matches ${daysOverdue} days — scheme has a gap`);
}

/**
 * The CRITICAL threshold: strictly more than 365 days overdue.
 *
 * Ratified as the SOLE criterion — no amount threshold, no additional condition.
 * Verified against the reference workbook: 366 is present, 365 is absent, and the
 * critical list length equalled the `> 365 jours` bucket count exactly.
 */
export const CRITICAL_THRESHOLD_DAYS = 365;

export function isCritical(daysOverdue: number): boolean {
  return daysOverdue > CRITICAL_THRESHOLD_DAYS;
}

/**
 * Client-level risk, WITH THE RATIFIED FLOOR.
 *
 * A client is rated by the bucket containing their AVERAGE delay — except that
 * the client scale has no « Non échu » level: an average of ≤ 30 days, including
 * a negative average, floors at « Faible ». This is not a simplification of the
 * row-level rule; it is a distinct rule, discovered because eight clients in the
 * reference workbook carried negative averages and were still rated « Faible ».
 * Inferring it from the invoice-level mapping would have produced the wrong
 * label for every client whose invoices are mostly not yet due.
 */
export function clientRisk(
  averageDaysOverdue: number,
  scheme: readonly BucketDefinition[] = AGING_BALANCE_V1,
): RiskKey {
  const risk = classifyDays(averageDaysOverdue, scheme).risk;
  return risk === "NON_ECHU" ? "FAIBLE" : risk;
}

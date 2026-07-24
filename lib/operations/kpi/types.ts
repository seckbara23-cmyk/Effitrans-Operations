/**
 * Executive KPI Engine — typed contract (Phase 10.0D-1). PURE TYPES.
 * ---------------------------------------------------------------------------
 * THE authoritative KPI shape (DEC-B35): one engine, many consumers. The
 * contract encodes the ratified doctrine so a misleading number cannot be
 * represented:
 *
 *  - MISSING ≠ NEGATIVE: `value: null` + `status` — never a confident zero.
 *  - CURRENCY SAFETY (DEC-B40): amount-kind KPIs carry per-currency values;
 *    a cross-currency scalar CANNOT be expressed.
 *  - TIME HONESTY (DEC-B38/B39): every KPI carries its window with the tenant
 *    timezone and the bounds actually used (start inclusive, end exclusive).
 *  - COMPARISON HONESTY (DEC-B41): prior 0/null ⇒ direction "unknown",
 *    changePercent null; the comparison label must name its basis.
 *  - TRACEABILITY: `source` names the authoritative reader (executive-types
 *    precedent) — a figure with no authoritative source cannot exist.
 *  - DATA QUALITY (DEC-B46): `basis` counts included/excluded rows; exclusions
 *    ⇒ status "partial", never silent false precision.
 *
 * No UI styling fields here — tone/layout stay a presentation mapping.
 */

export const KPI_WINDOW_KEYS = ["current", "today", "month_to_date"] as const;
export type KpiWindowKey = (typeof KPI_WINDOW_KEYS)[number];

export type KpiWindow = {
  key: KpiWindowKey;
  /** Tenant-tz ISO date bounds actually used (null for "current" snapshots). */
  start: string | null;
  /** Exclusive end bound (null for "current"). */
  end: string | null;
  /** The resolved organization.timezone this window was computed in (DEC-B39). */
  timezone: string;
};

/** One per-currency monetary value. NEVER summed across currencies (DEC-B40). */
export type KpiMoney = { currency: string; amount: number };

export type KpiComparison = {
  /** Honest basis naming, e.g. « vs juin (mois complet) » — mandatory. */
  label: string;
  value: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  /** Null when the prior value is 0 or null (DEC-B41) — never ∞ or a fabricated 100 %. */
  changePercent: number | null;
};

export type KpiStatus = "ready" | "partial" | "unavailable";

export type OperationsKpi = {
  /** Stable internal key, e.g. "dossiers_actifs". */
  key: string;
  /** French display label. */
  label: string;
  kind: "count" | "amount" | "rate" | "duration";
  /** count/rate/duration value; null = not available (never zero). */
  value: number | null;
  /** kind="amount" only: per-currency values (scalar rendering only when length === 1). */
  amounts?: KpiMoney[];
  unit?: "days" | "percent";
  window: KpiWindow;
  comparison?: KpiComparison;
  /** The authoritative reader this figure came from (traceability). */
  source: string;
  /** Only "live-request" exists in 10.0D (DEC-B45 — the page timestamp is the UI label). */
  freshness: "live-request";
  status: KpiStatus;
  /** Data-quality basis (DEC-B46): rows considered vs excluded as invalid. */
  basis?: { included: number; excluded: number; note?: string };
  /** Drill-down — only §16-audited destinations, never a promised filter that doesn't exist. */
  href?: string;
};

export type OperationsKpiSet = {
  generatedAt: string;
  /** Resolved tenant timezone every window in this set used. */
  timezone: string;
  canFinance: boolean;
  kpis: OperationsKpi[];
};

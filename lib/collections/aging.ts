/**
 * Collections aging model (Phase 5.0D, Deliverable 11). PURE and DETERMINISTIC.
 * ---------------------------------------------------------------------------
 * No AI. No stored aging. Everything is derived from the records that already
 * exist: invoice.due_date, invoice.status, the non-reversed payments, the dispute
 * flag, and today's date.
 *
 * THE RULE THAT MATTERS: an invoice with NO DUE DATE IS NEVER OVERDUE. It is
 * reported as `Échéance non définie` — the platform will not invent a commitment
 * the business never made.
 */

export const AGING_BUCKETS = [
  "NOT_DUE",
  "1_TO_30_DAYS",
  "31_TO_60_DAYS",
  "61_TO_90_DAYS",
  "OVER_90_DAYS",
  "PAID",
  "DISPUTED",
  /** No due date recorded — cannot be aged, and must never be called overdue. */
  "NO_DUE_DATE",
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABEL_FR: Record<AgingBucket, string> = {
  NOT_DUE: "Non échue",
  "1_TO_30_DAYS": "1 à 30 jours",
  "31_TO_60_DAYS": "31 à 60 jours",
  "61_TO_90_DAYS": "61 à 90 jours",
  OVER_90_DAYS: "Plus de 90 jours",
  PAID: "Payée",
  DISPUTED: "En litige",
  NO_DUE_DATE: "Échéance non définie",
};

export type AgingInput = {
  status: string;
  /** ISO date (yyyy-mm-dd) or null. */
  dueDate: string | null;
  /** Sum of the invoice's lines, taxes included. */
  total: number;
  /** Sum of NON-REVERSED payments. */
  paid: number;
  disputed: boolean;
  /** ISO date (yyyy-mm-dd) — injected, never Date.now(), so this stays pure. */
  today: string;
};

export type Aging = {
  bucket: AgingBucket;
  labelFr: string;
  outstanding: number;
  /** Null when there is no due date — NOT zero, and never a negative "overdue". */
  daysOutstanding: number | null;
  overdue: boolean;
  fullyPaid: boolean;
  partiallyPaid: boolean;
};

const DAY = 86_400_000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY);
}

export function evaluateAging(input: AgingInput): Aging {
  const outstanding = Math.max(0, Number((input.total - input.paid).toFixed(2)));
  const fullyPaid =
    input.status === "PAID" || (input.total > 0 && input.paid >= input.total);
  const partiallyPaid = !fullyPaid && input.paid > 0;

  const base = { outstanding, fullyPaid, partiallyPaid };

  if (fullyPaid) {
    return { ...base, bucket: "PAID", labelFr: AGING_LABEL_FR.PAID, daysOutstanding: null, overdue: false };
  }

  // A dispute freezes aging: chasing a disputed invoice as "90 days overdue" is
  // wrong, and escalating one is a business decision, not an arithmetic one.
  if (input.disputed) {
    return {
      ...base,
      bucket: "DISPUTED",
      labelFr: AGING_LABEL_FR.DISPUTED,
      daysOutstanding: null,
      overdue: false,
    };
  }

  // No due date => cannot be aged, and MUST NOT be called overdue.
  if (!input.dueDate) {
    return {
      ...base,
      bucket: "NO_DUE_DATE",
      labelFr: AGING_LABEL_FR.NO_DUE_DATE,
      daysOutstanding: null,
      overdue: false,
    };
  }

  const days = daysBetween(input.dueDate, input.today);

  if (days <= 0) {
    return { ...base, bucket: "NOT_DUE", labelFr: AGING_LABEL_FR.NOT_DUE, daysOutstanding: 0, overdue: false };
  }

  const bucket: AgingBucket =
    days <= 30 ? "1_TO_30_DAYS" : days <= 60 ? "31_TO_60_DAYS" : days <= 90 ? "61_TO_90_DAYS" : "OVER_90_DAYS";

  return { ...base, bucket, labelFr: AGING_LABEL_FR[bucket], daysOutstanding: days, overdue: true };
}

/** Ordering for the collections queue: oldest debt first, disputes last. */
const BUCKET_RANK: Record<AgingBucket, number> = {
  OVER_90_DAYS: 0,
  "61_TO_90_DAYS": 1,
  "31_TO_60_DAYS": 2,
  "1_TO_30_DAYS": 3,
  NOT_DUE: 4,
  NO_DUE_DATE: 5,
  DISPUTED: 6,
  PAID: 7,
};

export function compareAging(a: Aging, b: Aging): number {
  const r = BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
  if (r !== 0) return r;
  return b.outstanding - a.outstanding;
}

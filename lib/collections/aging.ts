/**
 * Collections aging model (Phase 5.0D-4, Deliverable 6). PURE and DETERMINISTIC.
 * ---------------------------------------------------------------------------
 * No AI. No stored aging. Derived from the records that already exist:
 * invoice.due_date, invoice.status, the NON-REVERSED payments, the dispute flag,
 * and today's date IN THE TENANT'S TIMEZONE.
 *
 * NO SECOND LEDGER. `paid` here is the SAME sum that drives invoice.status —
 * Σ non-reversed payments (lib/finance/calc.ts paidAmount). We deliberately do NOT
 * use a verified-only sum: invoice.status is not verified-driven, so a
 * verified-only balance would disagree with the invoice on every payment awaiting
 * verification. Payments pending verification are surfaced as a SIGNAL instead
 * (see ./priority), so Finance gets chased rather than the number quietly changing.
 *
 * THE RULE THAT MATTERS: an invoice with NO DUE DATE IS NEVER OVERDUE. It is
 * reported as DUE_DATE_MISSING — the platform will not invent a commitment the
 * business never made.
 */

export const AGING_BUCKETS = [
  "NOT_DUE",
  "DUE_TODAY",
  "1_TO_30_DAYS",
  "31_TO_60_DAYS",
  "61_TO_90_DAYS",
  "OVER_90_DAYS",
  "PAID",
  "DISPUTED",
  /** No due date recorded — cannot be aged, and must never be called overdue. */
  "DUE_DATE_MISSING",
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABEL_FR: Record<AgingBucket, string> = {
  NOT_DUE: "Non échue",
  DUE_TODAY: "Échéance aujourd'hui",
  "1_TO_30_DAYS": "1 à 30 jours",
  "31_TO_60_DAYS": "31 à 60 jours",
  "61_TO_90_DAYS": "61 à 90 jours",
  OVER_90_DAYS: "Plus de 90 jours",
  PAID: "Payée",
  DISPUTED: "En litige",
  DUE_DATE_MISSING: "Échéance non définie",
};

export type AgingInput = {
  status: string;
  /** ISO date (yyyy-mm-dd) or null. */
  dueDate: string | null;
  /** Sum of the invoice's lines, taxes included. */
  total: number;
  /** Σ NON-REVERSED payments — the same figure invoice.status is driven by. */
  paid: number;
  disputed: boolean;
  /**
   * Today in the TENANT'S timezone (yyyy-mm-dd), injected by the caller. Never
   * Date.now() here: a Dakar dossier must not age by a server's UTC clock.
   */
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
  return Math.floor((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY);
}

export function evaluateAging(input: AgingInput): Aging {
  const outstanding = Math.max(0, Number((input.total - input.paid).toFixed(2)));
  const fullyPaid = input.status === "PAID" || (input.total > 0 && input.paid >= input.total);
  const partiallyPaid = !fullyPaid && input.paid > 0;

  const base = { outstanding, fullyPaid, partiallyPaid };

  if (fullyPaid) {
    return { ...base, bucket: "PAID", labelFr: AGING_LABEL_FR.PAID, daysOutstanding: null, overdue: false };
  }

  // A dispute FREEZES aging. Chasing a disputed invoice as "90 days overdue" is
  // wrong, and escalating one is a business decision, not arithmetic. The amount
  // due is NOT erased — `outstanding` is still reported.
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
      bucket: "DUE_DATE_MISSING",
      labelFr: AGING_LABEL_FR.DUE_DATE_MISSING,
      daysOutstanding: null,
      overdue: false,
    };
  }

  const days = daysBetween(input.dueDate, input.today);

  if (days < 0) {
    return { ...base, bucket: "NOT_DUE", labelFr: AGING_LABEL_FR.NOT_DUE, daysOutstanding: 0, overdue: false };
  }
  // Due TODAY is not yet overdue — the client still has the day to pay.
  if (days === 0) {
    return { ...base, bucket: "DUE_TODAY", labelFr: AGING_LABEL_FR.DUE_TODAY, daysOutstanding: 0, overdue: false };
  }

  const bucket: AgingBucket =
    days <= 30 ? "1_TO_30_DAYS" : days <= 60 ? "31_TO_60_DAYS" : days <= 90 ? "61_TO_90_DAYS" : "OVER_90_DAYS";

  return { ...base, bucket, labelFr: AGING_LABEL_FR[bucket], daysOutstanding: days, overdue: true };
}

/** Ordering for the collections queue: oldest debt first, disputes and paid last. */
const BUCKET_RANK: Record<AgingBucket, number> = {
  OVER_90_DAYS: 0,
  "61_TO_90_DAYS": 1,
  "31_TO_60_DAYS": 2,
  "1_TO_30_DAYS": 3,
  DUE_TODAY: 4,
  NOT_DUE: 5,
  DUE_DATE_MISSING: 6,
  DISPUTED: 7,
  PAID: 8,
};

export function compareAging(a: Aging, b: Aging): number {
  const r = BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
  if (r !== 0) return r;
  return b.outstanding - a.outstanding;
}

/**
 * Today, in the tenant's timezone, as yyyy-mm-dd. A Dakar dossier must not age by
 * a server's UTC clock — at 23:30 UTC in Dakar it is still the same day, and an
 * invoice due today must not silently become overdue.
 */
export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An invalid tenant timezone must not crash the queue.
    return now.toISOString().slice(0, 10);
  }
}

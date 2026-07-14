/**
 * Collections — follow-ups, promises, disputes, priority (Phase 5.0D-4). PURE.
 * ---------------------------------------------------------------------------
 * Promise-to-pay is DERIVED from the append-only follow-up history — there is no
 * promise entity and no promise status column. A later promise SUPERSEDES an
 * earlier one without erasing it: the history is the truth, and its interpretation
 * is a pure function over it.
 *
 * A promise never changes the invoice's payment state and never advances closure.
 * No AI, no prediction.
 */
import type { Aging } from "./aging";

// ---------------------------------------------------------------- follow-ups ----

export const FOLLOW_UP_CHANNELS = [
  "PHONE",
  "EMAIL",
  "WHATSAPP",
  "IN_PERSON",
  "LETTER",
  "OTHER",
] as const;
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];

export const FOLLOW_UP_OUTCOMES = [
  "CLIENT_CONTACTED",
  "NO_RESPONSE",
  "PAYMENT_PROMISED",
  "PAYMENT_RECEIVED",
  "DISPUTED",
  "ESCALATED",
  "WRONG_CONTACT",
  "RESCHEDULED",
] as const;
export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOMES)[number];

export const MAX_NOTE = 500;

export function isChannel(v: string): v is FollowUpChannel {
  return (FOLLOW_UP_CHANNELS as readonly string[]).includes(v);
}
export function isOutcome(v: string): v is FollowUpOutcome {
  return (FOLLOW_UP_OUTCOMES as readonly string[]).includes(v);
}

/** Operationally necessary note ONLY — never a conversation transcript. */
export function sanitizeNote(note: string | null | undefined): string | null {
  const n = (note ?? "").trim();
  return n.length === 0 ? null : n.slice(0, MAX_NOTE);
}

export type FollowUp = {
  id: string;
  channel: string;
  outcome: string;
  note: string | null;
  promisedPaymentDate: string | null;
  promisedAmount: number | null;
  nextFollowUpAt: string | null;
  performedBy: string | null;
  createdAt: string;
};

// ------------------------------------------------------------------ promises ----

export type PromiseStatus = "active" | "met" | "missed" | "superseded" | "cancelled" | "none";

export type PromiseView = {
  status: PromiseStatus;
  promisedDate: string | null;
  promisedAmount: number | null;
  /** Earlier promises are kept, never erased. */
  supersededCount: number;
};

/**
 * Derive the promise state from the append-only history.
 *
 *   met        the balance reached zero (however it was paid)
 *   missed     the promised date has passed and a balance remains
 *   active     the promised date is still ahead
 *   superseded an earlier promise replaced by a later one (kept in the count)
 *
 * A missed promise is a deterministic PRIORITY SIGNAL, not a prediction.
 */
export function derivePromise(
  followUps: FollowUp[],
  outstanding: number,
  today: string,
): PromiseView {
  const promises = followUps
    .filter((f) => f.promisedPaymentDate !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (promises.length === 0) {
    return { status: "none", promisedDate: null, promisedAmount: null, supersededCount: 0 };
  }

  const latest = promises[promises.length - 1];
  const supersededCount = promises.length - 1;

  // Paid in full => the promise was met, whatever its date.
  if (outstanding <= 0) {
    return {
      status: "met",
      promisedDate: latest.promisedPaymentDate,
      promisedAmount: latest.promisedAmount,
      supersededCount,
    };
  }

  const missed = latest.promisedPaymentDate! < today;
  return {
    status: missed ? "missed" : "active",
    promisedDate: latest.promisedPaymentDate,
    promisedAmount: latest.promisedAmount,
    supersededCount,
  };
}

// ------------------------------------------------------------------ disputes ----

export const DISPUTE_CATEGORIES = [
  "AMOUNT",
  "SERVICE",
  "MISSING_DOCUMENT",
  "DELIVERY",
  "TAX",
  "DUPLICATE_INVOICE",
  "PAYMENT_ALREADY_MADE",
  "OTHER",
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export function isDisputeCategory(v: string): v is DisputeCategory {
  return (DISPUTE_CATEGORIES as readonly string[]).includes(v);
}

export type DisputeView = {
  open: boolean;
  category: string | null;
  reason: string | null;
  openedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
};

/** An OPEN dispute blocks closure. It does NOT erase the amount due. */
export function disputeBlocksClosure(d: DisputeView): boolean {
  return d.open;
}

// ------------------------------------------------------------------ priority ----

export type CollectionsSignals = {
  aging: Aging;
  promise: PromiseView;
  dispute: DisputeView;
  /** Hours since the last follow-up. Null when there has never been one. */
  hoursSinceLastFollowUp: number | null;
  /** A payment exists but Finance has not verified it yet. */
  paymentAwaitingVerification: boolean;
  escalated: boolean;
  /** Step 26 cannot proceed. */
  processBlocked: boolean;
};

export type PriorityReason = { code: string; labelFr: string; weight: number };

export type CollectionsPriority = {
  score: number;
  reasons: PriorityReason[];
  level: "critical" | "high" | "normal" | "low";
};

const R = (code: string, labelFr: string, weight: number): PriorityReason => ({ code, labelFr, weight });

/**
 * Deterministic, explainable priority. No AI, and NO invented SLA: the
 * "no recent follow-up" signal is an INTERNAL working interval (14 days), and it
 * says so — it is not a commitment Effitrans made to anyone.
 */
export const NO_FOLLOW_UP_INTERVAL_HOURS = 14 * 24;

export function evaluateCollectionsPriority(s: CollectionsSignals): CollectionsPriority {
  const reasons: PriorityReason[] = [];

  const bucketWeight: Record<string, number> = {
    OVER_90_DAYS: 50,
    "61_TO_90_DAYS": 35,
    "31_TO_60_DAYS": 25,
    "1_TO_30_DAYS": 15,
    DUE_TODAY: 5,
  };
  const bw = bucketWeight[s.aging.bucket] ?? 0;
  if (bw > 0) reasons.push(R(`aging_${s.aging.bucket}`, `Retard : ${s.aging.labelFr}`, bw));

  if (s.promise.status === "missed") {
    reasons.push(R("promise_missed", "Promesse de paiement non tenue", 40));
  }
  if (s.dispute.open) {
    reasons.push(R("dispute_open", "Litige ouvert à traiter", 35));
  }
  if (s.escalated) {
    reasons.push(R("escalated", "Escalade demandée", 30));
  }
  if (s.processBlocked) {
    reasons.push(R("process_blocked", "Étape 26 bloquée", 25));
  }
  if (s.paymentAwaitingVerification) {
    // Chase Finance, don't quietly change the balance.
    reasons.push(R("payment_awaiting_verification", "Paiement en attente de vérification (Finance)", 20));
  }
  if (
    s.hoursSinceLastFollowUp === null ||
    s.hoursSinceLastFollowUp >= NO_FOLLOW_UP_INTERVAL_HOURS
  ) {
    if (s.aging.outstanding > 0 && !s.aging.fullyPaid) {
      reasons.push(
        R(
          "no_recent_follow_up",
          "Aucune relance récente (intervalle interne de 14 jours, non contractuel)",
          15,
        ),
      );
    }
  }
  if (s.aging.outstanding >= 5_000_000) {
    reasons.push(R("high_balance", "Solde élevé", 15));
  }
  if (s.promise.status === "active") {
    // A live promise DE-prioritizes: chasing a client who committed to a date is
    // counterproductive.
    reasons.push(R("promise_active", "Promesse en cours — relance différée", -20));
  }

  const score = reasons.reduce((sum, r) => sum + r.weight, 0);
  const level: CollectionsPriority["level"] =
    score >= 70 ? "critical" : score >= 40 ? "high" : score >= 15 ? "normal" : "low";

  return { score, reasons, level };
}

/**
 * Payment-intent state (Phase 1.15B). PURE — no I/O, unit-tested.
 * ---------------------------------------------------------------------------
 * A payment_intent orchestrates a provider-initiated online payment. It is NOT
 * a money row: only a SUCCEEDED intent auto-creates a `payment`, so the 1.11
 * paid/balance formula is untouched. This module is the validation oracle for
 * the intent lifecycle — the DB `check` constrains the value set, this enforces
 * the allowed transitions and the trust guards.
 *
 *   CREATED ─▶ PENDING ─▶ PROCESSING ─▶ SUCCEEDED   (→ creates payment)
 *      └──────────┴────────────┴───────▶ FAILED / EXPIRED / CANCELLED
 */
export const INTENT_STATUSES = [
  "CREATED",
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const TERMINAL_STATUSES: readonly IntentStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
];

export const PROVIDERS = ["WAVE", "ORANGE_MONEY", "MOCK"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export function isIntentStatus(value: string): value is IntentStatus {
  return (INTENT_STATUSES as readonly string[]).includes(value);
}

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDERS as readonly string[]).includes(value);
}

export function isTerminal(status: IntentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Allowed forward transitions. Terminal states never change. */
const TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = {
  CREATED: ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"],
  PENDING: ["PROCESSING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransition(from: IntentStatus, to: IntentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Staff/portal may cancel only a still-open (non-terminal) intent. */
export function canCancel(status: IntentStatus): boolean {
  return !isTerminal(status);
}

/**
 * Amount-match guard for auto-record (Q4/Q6): the provider-confirmed amount must
 * equal the invoice's CURRENT balance due. No partial online payments (Q3), so a
 * strict equality (within a sub-cent epsilon for numeric(14,2)) is required.
 */
export function amountMatches(
  intentAmount: number,
  invoiceBalance: number,
  epsilon = 0.005,
): boolean {
  return Math.abs(intentAmount - invoiceBalance) <= epsilon;
}

/**
 * Has an intent passed its TTL? Pure (caller supplies `now`) so the lazy-expiry
 * check stays testable. Only open intents can expire.
 */
export function isExpired(
  status: IntentStatus,
  expiresAt: string | null,
  now: Date,
): boolean {
  if (isTerminal(status) || !expiresAt) return false;
  return new Date(expiresAt).getTime() <= now.getTime();
}

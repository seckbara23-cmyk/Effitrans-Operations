/**
 * Document expiry classification (Phase 1.8) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * EXPIRED is DERIVED, not stored (no scheduler this phase — same approach as
 * Phase 1.6 task overdue). `now` is injected so it is fully unit-testable. Dates
 * are compared on the UTC day (Effitrans operates on Dakar time, GMT+0 ≡ UTC).
 */
export type ExpiryState = "expired" | "expiring" | "valid" | "none";

const DAY_MS = 86_400_000;

function startOfUtcDay(d: Date): number {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x.getTime();
}

/**
 * Classify a document's `expiry_date` (a 'YYYY-MM-DD' date string):
 *   - none     : no expiry date
 *   - expired  : the date is before today
 *   - expiring : today .. today + leadDays inclusive
 *   - valid    : further out than leadDays
 */
export function classifyExpiry(
  expiryDate: string | null | undefined,
  now: Date,
  leadDays = 30,
): ExpiryState {
  if (!expiryDate) return "none";
  const exp = new Date(`${expiryDate}T00:00:00Z`).getTime();
  if (Number.isNaN(exp)) return "none";
  const today = startOfUtcDay(now);
  if (exp < today) return "expired";
  if (exp <= today + leadDays * DAY_MS) return "expiring";
  return "valid";
}

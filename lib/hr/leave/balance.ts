/**
 * HR-5 — leave balance arithmetic. PURE. No imports, no clock, no I/O.
 * ---------------------------------------------------------------------------
 * INTEGER DAY-TENTHS throughout, the aging engine's minor-unit discipline
 * applied to days: 10 = one day, 5 = half a day. No float ever decides how much
 * leave somebody has, so no rounding can quietly create or destroy a half-day.
 *
 * NOTHING HERE IS A LEGAL RULE. There is no accrual formula, no statutory
 * quantity, no carry-over policy and no public-holiday calendar — every input
 * is a number the tenant entered. This module only adds and subtracts.
 */

/** One working day, in tenths. */
export const DAY = 10;

export type EntitlementInput = {
  openingTenths: number;
  accruedTenths: number;
  takenTenths: number;
};

export type Balance = EntitlementInput & {
  /** opening + accrued − taken. May be negative: that is a real, visible state. */
  remainingTenths: number;
  /** True when more has been taken than granted — surfaced, never hidden. */
  overdrawn: boolean;
};

export function computeBalance(input: EntitlementInput): Balance {
  for (const [k, v] of Object.entries(input)) {
    if (!Number.isInteger(v)) throw new Error(`[hr-leave] ${k} must be an integer in day-tenths`);
    if (v < 0) throw new Error(`[hr-leave] ${k} must not be negative`);
  }
  const remainingTenths = input.openingTenths + input.accruedTenths - input.takenTenths;
  return { ...input, remainingTenths, overdrawn: remainingTenths < 0 };
}

/** « 12,5 j » — French formatting, one decimal only when there is a half. */
export function formatTenths(tenths: number): string {
  const neg = tenths < 0;
  const abs = Math.abs(tenths);
  const whole = Math.trunc(abs / DAY);
  const rest = abs % DAY;
  const body = rest === 0 ? String(whole) : `${whole},${rest}`;
  return `${neg ? "-" : ""}${body} j`;
}

/**
 * Inclusive calendar-day span, in tenths, for a whole-day request.
 * Deliberately calendar days, NOT working days: which days are working days
 * depends on a holiday calendar and a work pattern, neither of which exists
 * yet and neither of which may be invented here. A half-day request passes its
 * tenths explicitly instead.
 */
export function spanTenths(startISO: string, endISO: string): number {
  const start = Date.parse(`${startISO}T00:00:00Z`);
  const end = Date.parse(`${endISO}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error("[hr-leave] invalid date");
  if (end < start) throw new Error("[hr-leave] end before start");
  const days = Math.round((end - start) / 86_400_000) + 1;
  return days * DAY;
}

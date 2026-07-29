/**
 * Calendar-day arithmetic for the aging engine. PURE. No imports, NO CLOCK.
 * ---------------------------------------------------------------------------
 * The engine never asks what today is. `reporting_date` (« date d'arrêté ») is a
 * parameter supplied by the caller, which is what makes a historical report
 * reproducible: re-running an April arrêté in July must return April's figures.
 * Resolving "today in the tenant's timezone" is the caller's job (there is
 * already `todayInTimezone` in lib/collections/aging.ts for that).
 *
 * Dates are plain `YYYY-MM-DD` strings — the shape a Postgres `date` column
 * arrives in. Day counting goes through Date.UTC, which is a pure calendar
 * function (no local timezone, no DST, no clock), so a difference of whole days
 * is exact.
 */

declare const ISO_DATE_BRAND: unique symbol;

/** A calendar date, `YYYY-MM-DD`. Construct through `isoDate`. */
export type IsoDate = string & { readonly [ISO_DATE_BRAND]: true };

export class DateError extends Error {
  constructor(message: string) {
    super(`[aging/dates] ${message}`);
    this.name = "DateError";
  }
}

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validate and brand a `YYYY-MM-DD` string. Rejects impossible dates (2026-02-30). */
export function isoDate(value: string): IsoDate {
  const m = PATTERN.exec(value);
  if (!m) throw new DateError(`expected YYYY-MM-DD, received ${JSON.stringify(value)}`);
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const utc = Date.UTC(year, month - 1, day);
  const back = new Date(utc);
  // Round-trip check: Date.UTC silently rolls 2026-02-30 into March.
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    throw new DateError(`not a real calendar date: ${value}`);
  }
  return value as IsoDate;
}

/** Parse if valid, else null — for optional columns like `due_date`. */
export function tryIsoDate(value: string | null | undefined): IsoDate | null {
  if (value == null) return null;
  try {
    return isoDate(value);
  } catch {
    return null;
  }
}

const DAY_MS = 86_400_000;

function epochDay(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/**
 * Whole calendar days from `from` to `to`. Positive when `to` is later.
 *
 * `daysOverdue = differenceInDays(dueDate, reportingDate)`: 0 on the due date
 * itself, negative while the invoice is not yet due.
 */
export function differenceInDays(from: IsoDate, to: IsoDate): number {
  return epochDay(to) - epochDay(from);
}

/** True when `a` is on or before `b` — the as-of cutoff test. */
export function isOnOrBefore(a: IsoDate, b: IsoDate): boolean {
  return a <= b; // ISO dates are lexicographically ordered
}

/** True when `a` is strictly after `b`. */
export function isAfter(a: IsoDate, b: IsoDate): boolean {
  return a > b;
}

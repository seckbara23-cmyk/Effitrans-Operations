/**
 * Money for the aging engine — INTEGER MINOR UNITS. PURE. No imports.
 * ---------------------------------------------------------------------------
 * Ratified constraint (FIN-AGING-1): no floating-point money calculations.
 *
 * Every amount is a whole number of minor units (centimes for XOF-with-scale-2,
 * matching `numeric(14,2)` in the database). `1 234,56 FCFA` is the integer
 * 123456. Addition and subtraction of integers are exact in IEEE-754 as long as
 * the result stays a safe integer, so the arithmetic below cannot drift; the
 * constructor refuses anything that is not a safe integer, which makes the
 * "no floats" property structural rather than a convention people remember.
 *
 * Headroom: `numeric(14,2)` tops out at 999 999 999 999,99 → 99 999 999 999 999
 * minor units, comfortably below Number.MAX_SAFE_INTEGER (9 007 199 254 740 991).
 * A portfolio of such invoices would still need ~90 of them to overflow, so
 * `sum` checks the running total rather than assuming.
 *
 * Division NEVER produces money. Shares are basis points (see ./share), averages
 * of days are integers — nothing in this engine multiplies or divides an amount
 * by a fraction, which is exactly where rounding drift would enter.
 */

declare const MONEY_BRAND: unique symbol;

/** A whole number of minor units. Construct only through `money`/`parseAmount`. */
export type Money = number & { readonly [MONEY_BRAND]: true };

export const ZERO = 0 as Money;

export class MoneyError extends Error {
  constructor(message: string) {
    super(`[aging/money] ${message}`);
    this.name = "MoneyError";
  }
}

/** Wrap a whole number of minor units. Throws on anything that is not a safe integer. */
export function money(minorUnits: number): Money {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new MoneyError(
      `amount must be a safe integer number of minor units, received ${String(minorUnits)}`,
    );
  }
  return minorUnits as Money;
}

/**
 * Parse a decimal amount STRING (the shape `numeric(14,2)` arrives in from
 * PostgREST) into minor units WITHOUT going through a float.
 *
 * Deliberately string-based: `Number("0.07") * 100` is 7.000000000000001, and
 * that is the class of error this whole module exists to make impossible.
 */
export function parseAmount(value: string, scale = 2): Money {
  const trimmed = value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!m) throw new MoneyError(`unparseable amount ${JSON.stringify(value)}`);
  const [, sign, whole, frac = ""] = m;
  if (frac.length > scale) {
    // Silently truncating a centime is how ledgers stop balancing.
    throw new MoneyError(
      `amount ${JSON.stringify(value)} has more than ${scale} decimal places`,
    );
  }
  const padded = (frac + "0".repeat(scale)).slice(0, scale);
  const digits = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) throw new MoneyError(`amount ${JSON.stringify(value)} exceeds safe range`);
  return money(sign === "-" ? -n : n);
}

export function add(a: Money, b: Money): Money {
  return money(a + b);
}

export function subtract(a: Money, b: Money): Money {
  return money(a - b);
}

export function sum(values: readonly Money[]): Money {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total)) throw new MoneyError("running total left the safe integer range");
  }
  return money(total);
}

/**
 * Clamp a negative balance to zero.
 *
 * Ratified rule: "overpayments must not create a negative invoice receivable".
 * The overpaid amount is NOT lost — it is reported as an unapplied credit signal
 * by the caller; this function only refuses to state a negative receivable.
 */
export function clampAtZero(a: Money): Money {
  return a < 0 ? ZERO : a;
}

export function isZero(a: Money): boolean {
  return a === 0;
}

export function isPositive(a: Money): boolean {
  return a > 0;
}

/** Descending comparator (largest amount first) — the workbook's ranking order. */
export function compareDesc(a: Money, b: Money): number {
  return b - a;
}

/** Minor units → the numeric value a renderer formats. Presentation boundary only. */
export function toMajorUnits(a: Money, scale = 2): number {
  return a / 10 ** scale;
}

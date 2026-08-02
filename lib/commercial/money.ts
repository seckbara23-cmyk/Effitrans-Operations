/**
 * EC-3B — commercial money PRIMITIVES. PURE. No imports, no I/O, no server-only.
 * ---------------------------------------------------------------------------
 * INTEGER MINOR UNITS ONLY. Every amount is a `bigint`-backed integer count of
 * minor units (XOF centimes); every quantity is an integer count of
 * thousandths; every tax rate is an integer count of basis points. No `number`
 * arithmetic on money crosses this module without rounding to an integer, and
 * no float ever reaches the database.
 *
 * WHY THIS DIFFERS FROM FINANCE. `invoice_line` and `billing_charge` use
 * numeric(14,2) — chosen in June, before the integer-minor-unit discipline was
 * ratified by FIN-AGING and carried through HR-5 (day tenths) and HR-6 (basis
 * points). New commercial tables follow the newer discipline; conversion to
 * Finance's numeric happens once, at the boundary, in EC-3D.
 *
 * WHAT THIS MODULE REFUSES TO DO: decide a tax rate, decide a rounding policy
 * for tax, or mandate a total. `lineTotalMinor` computes an EXCLUSIVE-of-tax
 * subtotal, which is pure arithmetic over the numbers a user typed. Tax
 * behaviour is MD-Q10 and is deliberately absent.
 */

/** Quantities are integer thousandths: 1 unit = 1000, 1.5 units = 1500. */
export const QUANTITY_SCALE = 1000;
/** Rates are integer basis points: 100 % = 10000. */
export const RATE_SCALE = 10000;
/** XOF has no minor unit in practice, but the platform stores centimes. */
export const MINOR_UNITS_PER_MAJOR = 100;

/** Parse a user-typed quantity into integer thousandths. Null when unusable. */
export function parseQuantityMilli(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  const n = Number(String(input).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const milli = Math.round(n * QUANTITY_SCALE);
  return milli > 0 ? milli : null;
}

/** Parse a user-typed amount into integer MINOR units. Null when unusable. */
export function parseAmountMinor(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  const n = Number(String(input).replace(/\s/g, "").replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * MINOR_UNITS_PER_MAJOR);
}

/** Parse a user-typed percentage into integer basis points. Null when unusable. */
export function parseRateBp(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return 0;
  const n = Number(String(input).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0 || n > 1000) return null;
  return Math.round(n * 100);
}

/**
 * Subtotal for one line, EXCLUSIVE of tax, in minor units.
 * quantity_milli × unit_amount_minor ÷ 1000, rounded half-up to an integer.
 * Pure integer arithmetic in, integer out — no float is ever stored.
 */
export function lineSubtotalMinor(quantityMilli: number, unitAmountMinor: number): number {
  if (!Number.isInteger(quantityMilli) || !Number.isInteger(unitAmountMinor)) {
    throw new Error("[commercial] money arithmetic requires integers");
  }
  return Math.round((quantityMilli * unitAmountMinor) / QUANTITY_SCALE);
}

/**
 * Tax for one line, in minor units, at the rate THE TENANT ENTERED.
 * With the default rate of 0 this returns 0 — the platform encodes no tax rule
 * and a quotation is valid with no tax at all (MD-Q10 unanswered by design).
 */
export function lineTaxMinor(subtotalMinor: number, taxRateBp: number): number {
  if (!Number.isInteger(subtotalMinor) || !Number.isInteger(taxRateBp)) {
    throw new Error("[commercial] money arithmetic requires integers");
  }
  if (taxRateBp === 0) return 0;
  return Math.round((subtotalMinor * taxRateBp) / RATE_SCALE);
}

export type QuotationLineLike = {
  quantityMilli: number;
  unitAmountMinor: number;
  taxRateBp: number;
};

export type QuotationTotals = {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** True when no line carries a tax rate — the UI then shows no tax row. */
  taxFree: boolean;
};

/**
 * Totals for a set of lines. A DISPLAY aggregate: it is never stored, never
 * emitted in an event, and never treated as the authority. The lines are.
 */
export function quotationTotals(lines: readonly QuotationLineLike[]): QuotationTotals {
  let subtotalMinor = 0;
  let taxMinor = 0;
  let anyTax = false;
  for (const l of lines) {
    const sub = lineSubtotalMinor(l.quantityMilli, l.unitAmountMinor);
    subtotalMinor += sub;
    if (l.taxRateBp > 0) anyTax = true;
    taxMinor += lineTaxMinor(sub, l.taxRateBp);
  }
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor, taxFree: !anyTax };
}

/** Render minor units as "1 234 567,89". Presentation only. */
export function formatAmountMinor(minor: number, currency = "XOF"): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const cents = abs % MINOR_UNITS_PER_MAJOR;
  // U+00A0 (non-breaking space) as the thousands separator: the French
  // typographic convention, and it stops a number wrapping mid-figure.
  // Written as an ESCAPE so the choice is visible in review rather than
  // surviving as an invisible byte.
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped},${String(cents).padStart(2, "0")} ${currency}`;
}

/** Render integer thousandths as "1,5". Presentation only. */
export function formatQuantityMilli(milli: number): string {
  const s = (milli / QUANTITY_SCALE).toFixed(3).replace(/\.?0+$/, "");
  return s.replace(".", ",");
}

/** Render basis points as "18,00 %". Presentation only. */
export function formatRateBp(bp: number): string {
  return `${(bp / 100).toFixed(2).replace(".", ",")} %`;
}

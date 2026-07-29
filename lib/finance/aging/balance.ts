/**
 * Outstanding balance AS OF a reporting date. PURE.
 * ---------------------------------------------------------------------------
 * Ratified 2026-07-29 (Q-01 / Q-03):
 *
 *   outstanding(D) = original invoice amount
 *                  − payments allocated on or before D
 *                  − credit notes allocated on or before D
 *                  ± approved adjustments effective on or before D
 *
 * and the rules that go with it:
 *   * movements dated AFTER D are ignored — a report is a statement about D, and
 *     entering a payment tomorrow must not silently rewrite yesterday's report;
 *   * a partial payment reduces the amount but NEVER restarts the aging clock —
 *     the invoice keeps ageing from its contractual due date;
 *   * overpayment never produces a negative receivable; the excess surfaces as an
 *     unapplied credit instead of quietly netting against the portfolio;
 *   * allocation is EXPLICIT. There is no FIFO fallback here and no automatic
 *     spreading of an unallocated payment across invoices: an allocation exists
 *     because someone recorded it, which is what makes it auditable.
 *
 * REVERSALS are dated, like everything else. A payment reversed on or before D
 * never counted at D; a payment reversed AFTER D still counted at D. That is the
 * same knowledge-date discipline as the cutoff above, applied consistently, and
 * it is what makes a finalized report reproducible.
 */
import { ZERO, clampAtZero, money, subtract, type Money } from "./money";
import { isAfter, isOnOrBefore, type IsoDate } from "./dates";
import type { Allocation, InvoiceInput } from "./types";

/** Direction each kind moves the receivable: −1 reduces it, +1 increases it. */
const DIRECTION: Record<Allocation["kind"], -1 | 1> = {
  PAYMENT: -1,
  CREDIT_NOTE: -1,
  ADJUSTMENT_CREDIT: -1,
  ADJUSTMENT_DEBIT: 1,
};

/** True when this allocation is in force as of `asOf`. */
export function isEffectiveAsOf(allocation: Allocation, asOf: IsoDate): boolean {
  if (isAfter(allocation.effectiveDate, asOf)) return false; // dated after the arrêté
  if (allocation.reversedOn && isOnOrBefore(allocation.reversedOn, asOf)) return false; // already reversed by then
  return true;
}

export type BalanceAsOf = {
  /** The invoice's gross amount — retained, never used for aggregation (Q-01). */
  original: Money;
  /** Σ reductions in force at the date (payments, credit notes, credit adjustments). */
  reductions: Money;
  /** Σ debit adjustments in force at the date. */
  debits: Money;
  /** The receivable, clamped at zero. THIS is « Montant » everywhere. */
  outstanding: Money;
  /** Positive only when the invoice is overpaid; reported, never netted away. */
  overpayment: Money;
  /** True when at least one reduction applies but the invoice is not settled. */
  partiallySettled: boolean;
  /** True when reductions have met or exceeded the amount due. */
  fullySettled: boolean;
};

export function balanceAsOf(invoice: InvoiceInput, asOf: IsoDate): BalanceAsOf {
  let reductions = 0;
  let debits = 0;

  for (const a of invoice.allocations) {
    if (!isEffectiveAsOf(a, asOf)) continue;
    if (a.amount < 0) {
      // Direction is carried by `kind`; a negative magnitude would double-negate.
      throw new Error(
        `[aging/balance] allocation amounts must be positive magnitudes (invoice ${invoice.invoiceNumber})`,
      );
    }
    if (DIRECTION[a.kind] === -1) reductions += a.amount;
    else debits += a.amount;
  }

  const original = invoice.originalAmount;
  const due = money(original + debits);
  const raw = subtract(due, money(reductions));
  const outstanding = clampAtZero(raw);
  const overpayment = raw < 0 ? money(-raw) : ZERO;

  return {
    original,
    reductions: money(reductions),
    debits: money(debits),
    outstanding,
    overpayment,
    partiallySettled: reductions > 0 && outstanding > 0,
    fullySettled: outstanding === 0 && (reductions > 0 || due === 0),
  };
}

/**
 * Was this invoice cancelled as of the date?
 *
 * As-of, deliberately: an invoice voided in July was still a live receivable in
 * the June arrêté, and re-running June must still say so.
 */
export function isCancelledAsOf(invoice: InvoiceInput, asOf: IsoDate): boolean {
  return invoice.cancelledOn !== null && isOnOrBefore(invoice.cancelledOn, asOf);
}

/**
 * Was this invoice issued as of the date?
 *
 * A DRAFT is not a receivable — nobody has been asked to pay. `issueDate` is
 * likewise compared as-of so a report cannot include an invoice issued after it.
 */
export function isIssuedAsOf(invoice: InvoiceInput, asOf: IsoDate): boolean {
  if (invoice.status === "DRAFT") return false;
  return isOnOrBefore(invoice.issueDate, asOf);
}

/**
 * Invoice issuance validation (UAT-2A) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Issuance is the moment a draft becomes an ACCOUNTING DOCUMENT: it consumes an
 * official, immutable, tenant-scoped invoice number that can never be reused.
 * Everything that must be true about an invoice has to be true BEFORE that
 * number is allocated — afterwards there is no clean way back.
 *
 * `issueInvoice` previously checked only that at least one line row existed. An
 * invoice whose lines summed to zero — or to a negative — issued successfully
 * and burned an official number on a document with no accounting meaning.
 *
 * This module re-validates the PERSISTED lines rather than trusting that they
 * were checked on the way in. `validateLineAmounts` guards the insert path, but
 * rows can predate that guard, arrive through a different path, or be edited;
 * the authoritative check belongs at the irreversible step. Client-side
 * controls are a convenience — this is the authority.
 */
import { invoiceTotals, validateLineAmounts, MAX_LINE_AMOUNT } from "./calc";

export type IssuanceLine = {
  description?: string | null;
  quantity: number;
  unitAmount: number;
  taxRate: number;
};

export type IssuanceError =
  | "no_lines"
  | "invalid_amount"
  | "zero_total"
  | "negative_total"
  | "total_too_large"
  | "due_before_issue"
  | "invalid_due_date";

export type IssuanceCheck = { ok: true; total: number } | { ok: false; error: IssuanceError };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * May this draft be issued?
 *
 * Order matters: the most specific, most explainable failure wins, so the
 * operator is told what is actually wrong rather than a generic refusal.
 */
export function validateIssuance(input: {
  lines: readonly IssuanceLine[];
  issueDate: string;
  dueDate?: string | null;
}): IssuanceCheck {
  const { lines, issueDate, dueDate } = input;

  if (!lines || lines.length === 0) return { ok: false, error: "no_lines" };

  // Every persisted line must independently be sane. A single malformed row
  // (NaN, Infinity, negative unit price, tax outside 0-100) invalidates the
  // whole document — an accounting record is not partially correct.
  for (const l of lines) {
    if (
      !Number.isFinite(l.quantity) ||
      !Number.isFinite(l.unitAmount) ||
      !Number.isFinite(l.taxRate)
    ) {
      return { ok: false, error: "invalid_amount" };
    }
    if (validateLineAmounts({ quantity: l.quantity, unitAmount: l.unitAmount, taxRate: l.taxRate })) {
      return { ok: false, error: "invalid_amount" };
    }
  }

  // The total is computed from the SAME function the UI and the PDF use, so
  // the number validated here is the number that will be billed.
  const { total } = invoiceTotals(
    lines.map((l) => ({ quantity: l.quantity, unitAmount: l.unitAmount, taxRate: l.taxRate })),
  );

  if (!Number.isFinite(total)) return { ok: false, error: "invalid_amount" };
  if (total < 0) return { ok: false, error: "negative_total" };
  if (total === 0) return { ok: false, error: "zero_total" };
  if (total > MAX_LINE_AMOUNT) return { ok: false, error: "total_too_large" };

  if (dueDate !== undefined && dueDate !== null && dueDate !== "") {
    if (!ISO_DATE.test(dueDate)) return { ok: false, error: "invalid_due_date" };
    const due = Date.parse(`${dueDate}T00:00:00Z`);
    if (Number.isNaN(due)) return { ok: false, error: "invalid_due_date" };
    // An invoice due before it exists is not a payment term, it is a mistake.
    const issued = Date.parse(`${issueDate}T00:00:00Z`);
    if (Number.isFinite(issued) && due < issued) return { ok: false, error: "due_before_issue" };
  }

  return { ok: true, total };
}

/** Default terms when the operator does not choose: 30 days. Unchanged. */
export const DEFAULT_PAYMENT_TERM_DAYS = 30;

/** Selectable terms for the issuance modal. `null` = pick a date manually. */
export const PAYMENT_TERMS: readonly { days: number | null; labelFr: string }[] = [
  { days: 0, labelFr: "Comptant" },
  { days: 15, labelFr: "15 jours" },
  { days: 30, labelFr: "30 jours" },
  { days: 45, labelFr: "45 jours" },
  { days: null, labelFr: "Personnalisé" },
];

/** issueDate + days, as an ISO date. PURE — the caller supplies "today". */
export function dueDateFromTerm(issueDate: string, days: number): string {
  const base = Date.parse(`${issueDate}T00:00:00Z`);
  if (!Number.isFinite(base)) return issueDate;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

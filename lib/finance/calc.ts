/**
 * Finance money math (Phase 1.11) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * The single source of truth for invoice totals, paid amount, balance, the
 * payment-driven status, and the overdue flag. No I/O — fully unit-tested.
 * Amounts are plain numbers (XOF default); rounded to 2 decimals defensively.
 */
import type { InvoiceStatus, PaymentMethod } from "./types";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "BANK_TRANSFER",
  "CHEQUE",
  "WAVE",
  "ORANGE_MONEY",
  "OTHER",
];

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type LineLike = { quantity: number; unitAmount: number; taxRate: number };

export function lineAmount(line: { quantity: number; unitAmount: number }): number {
  return round2(line.quantity * line.unitAmount);
}

export function lineTax(line: LineLike): number {
  return round2(lineAmount(line) * (line.taxRate / 100));
}

export function invoiceTotals(lines: LineLike[]): {
  subtotal: number;
  tax: number;
  total: number;
} {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    subtotal += lineAmount(l);
    tax += lineTax(l);
  }
  subtotal = round2(subtotal);
  tax = round2(tax);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

/** Sum of NON-reversed payments. */
export function paidAmount(payments: { amount: number; reversed: boolean }[]): number {
  return round2(payments.filter((p) => !p.reversed).reduce((s, p) => s + p.amount, 0));
}

export function balanceDue(total: number, paid: number): number {
  return round2(total - paid);
}

/** Payment-driven status for an issued invoice (VOID/DRAFT handled elsewhere). */
export function paymentStatus(total: number, paid: number): InvoiceStatus {
  if (paid <= 0) return "ISSUED";
  if (round2(paid) >= round2(total)) return "PAID";
  return "PARTIALLY_PAID";
}

/** Overdue = issued/partially-paid, past due date, with a remaining balance. */
export function isOverdue(
  status: InvoiceStatus,
  dueDate: string | null,
  balance: number,
  now: Date,
): boolean {
  if (status !== "ISSUED" && status !== "PARTIALLY_PAID") return false;
  if (!dueDate || balance <= 0) return false;
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  if (Number.isNaN(due)) return false;
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  return due < today.getTime();
}

/**
 * Invoice workflow predicates (Phase 1.11) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * DRAFT -> ISSUED -> (PARTIALLY_PAID) -> PAID; ISSUED/PARTIALLY_PAID -> VOID.
 * Payment-driven states (PARTIALLY_PAID/PAID) are set by the payment action via
 * calc.paymentStatus; these guards govern the manual actions. Unit-tested.
 */
import type { InvoiceStatus } from "./types";

export const INVOICE_STATUSES: InvoiceStatus[] = [
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "VOID",
];

export function isInvoiceStatus(v: string): v is InvoiceStatus {
  return (INVOICE_STATUSES as string[]).includes(v);
}

/** Charges/lines/header are editable only while the invoice is a DRAFT. */
export function canEditInvoice(status: InvoiceStatus): boolean {
  return status === "DRAFT";
}

export function canIssue(status: InvoiceStatus): boolean {
  return status === "DRAFT";
}

/** Void allowed on an issued, not-fully-paid invoice (reverse payments first). */
export function canVoid(status: InvoiceStatus): boolean {
  return status === "ISSUED" || status === "PARTIALLY_PAID";
}

/** Payments only against an issued invoice with a remaining balance. */
export function canRecordPayment(status: InvoiceStatus): boolean {
  return status === "ISSUED" || status === "PARTIALLY_PAID";
}

/** Hard-delete is only for an un-issued DRAFT (issued ones are voided). */
export function canDeleteInvoice(status: InvoiceStatus): boolean {
  return status === "DRAFT";
}

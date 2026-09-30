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
  // Phase 5.0D — the Finance CHECKER half of official step 21.
  "VALIDATED",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "VOID",
];

export function isInvoiceStatus(v: string): v is InvoiceStatus {
  return (INVOICE_STATUSES as string[]).includes(v);
}

/**
 * The statuses of an invoice that has ACTUALLY BEEN ISSUED
 * (STEP22-ISSUANCE-INTEGRITY-01).
 *
 * WHAT THIS REPLACES, AND WHY IT IS ONE FUNCTION. Seven places independently
 * spelled "issued" as `status !== "DRAFT" && status !== "VOID"`, which is true
 * of VALIDATED — an invoice the Finance checker has approved and which has no
 * official number, no issue date and no official document. On
 * EFT-IMP-2026-00013 that let a VALIDATED invoice satisfy the FINAL_INVOICE
 * HARD_GATE, let the generic control close official step 22, and put
 * « Facture émise » on a dossier whose invoice had never been sent.
 *
 * ISSUANCE IS A FACT, NOT AN ABSENCE. It is what `emailValidatedInvoice`
 * writes: an official number, the ISSUED status, and `issued_by`/`issued_at`.
 * Asking "is it not a draft" answers a different question, and the two only
 * looked the same while VALIDATED did not exist.
 *
 * NOT the same as `VALIDATED_OR_BEYOND` in lib/files/qc6.ts, which genuinely
 * means "the checker has approved it" and is unaffected.
 */
export const ISSUED_STATUSES: readonly InvoiceStatus[] = ["ISSUED", "PARTIALLY_PAID", "PAID"];

export function isIssuedStatus(status: string): boolean {
  return (ISSUED_STATUSES as readonly string[]).includes(status);
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

/**
 * Finance Expense Documents — numbering contract (Phase 11.0B). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * Document numbers are minted by the tenant×year Postgres RPCs
 * next_expense_authorization_number / next_expense_voucher_number (migration
 * 20260725000001) — the proven invoice_counter pattern: per tenant, yearly
 * reset, atomic, gaps allowed, never reused, assigned AT SUBMISSION not draft
 * (DEC-C14). This module holds the FORMAT SPEC + validators the readers/actions
 * and tests share; the actual minting is server-side (./actions).
 */

export const AUTHORIZATION_NUMBER_PREFIX = "EFT-AUT";
export const VOUCHER_NUMBER_PREFIX = "EFT-BON";

/** EFT-AUT-YYYY-##### (5-digit sequence). */
export const AUTHORIZATION_NUMBER_PATTERN = /^EFT-AUT-\d{4}-\d{5}$/;
/** EFT-BON-YYYY-##### (5-digit sequence). */
export const VOUCHER_NUMBER_PATTERN = /^EFT-BON-\d{4}-\d{5}$/;

export function isAuthorizationNumber(v: string): boolean {
  return AUTHORIZATION_NUMBER_PATTERN.test(v);
}

export function isVoucherNumber(v: string): boolean {
  return VOUCHER_NUMBER_PATTERN.test(v);
}

/** The RPC that mints each document type's number (called only server-side). */
export const AUTHORIZATION_NUMBER_RPC = "next_expense_authorization_number";
export const VOUCHER_NUMBER_RPC = "next_expense_voucher_number";

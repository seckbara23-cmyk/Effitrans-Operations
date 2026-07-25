/**
 * Finance Expense Documents — pure contracts (Phase 11.0B). No I/O; client +
 * server safe. The typed vocabulary and lifecycle RULES of the two paper
 * documents — Autorisation de Dépenses and Bon de Dépenses (docs/finance/
 * phase-11.0a-expense-authorization-architecture.md; DEC-C05..C25).
 *
 * This is the FOUNDATION's state-machine layer: statuses, their legal
 * transitions, the visa step vocabulary, material-field sets, methods and
 * document types. The server actions (./actions) delegate every lifecycle
 * decision here, mirroring lib/finance/requests.ts and the process engine's
 * state.ts discipline. NO approval/signature is performed in 11.0B — the
 * vocabulary exists for 11.0C..11.0G to consume.
 */

// ============================================================ document types ==

export const EXPENSE_DOCUMENT_TYPES = ["EXPENSE_AUTHORIZATION", "EXPENSE_VOUCHER"] as const;
export type ExpenseDocumentType = (typeof EXPENSE_DOCUMENT_TYPES)[number];

export function isExpenseDocumentType(v: string): v is ExpenseDocumentType {
  return (EXPENSE_DOCUMENT_TYPES as readonly string[]).includes(v);
}

// =================================================== authorization lifecycle ==

export const AUTHORIZATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_APPROVAL",
  "RETURNED",
  "REJECTED",
  "APPROVED",
  "CANCELLED",
  "SUPERSEDED",
] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

/**
 * Legal transitions for the Autorisation de Dépenses. REJECTED / CANCELLED /
 * SUPERSEDED are terminal. RETURNED is the correction path (a corrected version
 * re-enters approval). The single edge into APPROVED is from IN_APPROVAL — the
 * gate a voucher's creation is compare-and-set against (DEC-C06).
 */
const AUTHORIZATION_TRANSITIONS: Record<AuthorizationStatus, AuthorizationStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["IN_APPROVAL", "RETURNED", "CANCELLED"],
  IN_APPROVAL: ["APPROVED", "REJECTED", "RETURNED", "CANCELLED"],
  RETURNED: ["SUBMITTED", "IN_APPROVAL", "CANCELLED"],
  APPROVED: ["SUPERSEDED", "CANCELLED"],
  REJECTED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

export function canTransitionAuthorization(from: AuthorizationStatus, to: AuthorizationStatus): boolean {
  return AUTHORIZATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isAuthorizationStatus(v: string): v is AuthorizationStatus {
  return (AUTHORIZATION_STATUSES as readonly string[]).includes(v);
}

/** Terminal = no outgoing transition. */
export function isAuthorizationTerminal(s: AuthorizationStatus): boolean {
  return (AUTHORIZATION_TRANSITIONS[s]?.length ?? 0) === 0;
}

/** Statuses in which the working head fields may still be edited in place. */
export const AUTHORIZATION_EDITABLE_STATUSES: readonly AuthorizationStatus[] = ["DRAFT", "RETURNED"];

export const AUTHORIZATION_STATUS_LABELS_FR: Readonly<Record<AuthorizationStatus, string>> = {
  DRAFT: "Brouillon",
  SUBMITTED: "Soumise",
  IN_APPROVAL: "En attente de visas",
  RETURNED: "Retournée pour correction",
  REJECTED: "Rejetée",
  APPROVED: "Approuvée",
  CANCELLED: "Annulée",
  SUPERSEDED: "Remplacée",
};

// ========================================================= voucher lifecycle ==

export const VOUCHER_STATUSES = [
  "DRAFT",
  "IN_SIGNATURE",
  "RETURNED",
  "REJECTED",
  "FULLY_SIGNED",
  "READY_FOR_PAYMENT",
  "PAID",
  "RECONCILED",
  "CLOSED",
  "CANCELLED",
  "SUPERSEDED",
] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/**
 * Legal transitions for the Bon de Dépenses. Payment eligibility is a distinct
 * state (READY_FOR_PAYMENT) reached only after FULLY_SIGNED — approval is never
 * payment (DEC-C21). PAID is NOT terminal (→ RECONCILED → CLOSED). REJECTED /
 * CANCELLED / CLOSED / SUPERSEDED are terminal.
 */
const VOUCHER_TRANSITIONS: Record<VoucherStatus, VoucherStatus[]> = {
  DRAFT: ["IN_SIGNATURE", "CANCELLED"],
  IN_SIGNATURE: ["FULLY_SIGNED", "RETURNED", "REJECTED", "CANCELLED"],
  RETURNED: ["IN_SIGNATURE", "CANCELLED"],
  FULLY_SIGNED: ["READY_FOR_PAYMENT", "SUPERSEDED", "CANCELLED"],
  READY_FOR_PAYMENT: ["PAID", "SUPERSEDED", "CANCELLED"],
  PAID: ["RECONCILED"],
  RECONCILED: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

export function canTransitionVoucher(from: VoucherStatus, to: VoucherStatus): boolean {
  return VOUCHER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isVoucherStatus(v: string): v is VoucherStatus {
  return (VOUCHER_STATUSES as readonly string[]).includes(v);
}

export function isVoucherTerminal(s: VoucherStatus): boolean {
  return (VOUCHER_TRANSITIONS[s]?.length ?? 0) === 0;
}

export const VOUCHER_EDITABLE_STATUSES: readonly VoucherStatus[] = ["DRAFT", "RETURNED"];

/** The payment gate (DEC-C21): a voucher is eligible only when READY_FOR_PAYMENT. */
export function isPaymentEligible(s: VoucherStatus): boolean {
  return s === "READY_FOR_PAYMENT";
}

export const VOUCHER_STATUS_LABELS_FR: Readonly<Record<VoucherStatus, string>> = {
  DRAFT: "Brouillon",
  IN_SIGNATURE: "En attente de signatures",
  RETURNED: "Retourné pour correction",
  REJECTED: "Rejeté",
  FULLY_SIGNED: "Entièrement signé",
  READY_FOR_PAYMENT: "Prêt au paiement",
  PAID: "Payé",
  RECONCILED: "Rapproché",
  CLOSED: "Clôturé",
  CANCELLED: "Annulé",
  SUPERSEDED: "Remplacé",
};

// ======================================================== approval attempts ==

export const APPROVAL_ATTEMPT_STATUSES = [
  "IN_PROGRESS",
  "APPROVED",
  "REJECTED",
  "RETURNED",
  "SUPERSEDED",
] as const;
export type ApprovalAttemptStatus = (typeof APPROVAL_ATTEMPT_STATUSES)[number];

export function isApprovalAttemptOpen(s: ApprovalAttemptStatus): boolean {
  return s === "IN_PROGRESS";
}

// ================================================================ visa ledger ==

export const VISA_DECISIONS = ["APPROVED", "REJECTED", "RETURNED"] as const;
export type VisaDecision = (typeof VISA_DECISIONS)[number];

export type VisaStep = { code: string; ordinal: number };

/**
 * The ordered visa chains, exactly as printed on the paper forms (DEC-C08/C09).
 * These declare the STEP VOCABULARY + ORDER only — the signer-map (step → role)
 * is built in 11.0C/D. Two steps are UNMAPPED business blockers and carry no
 * role anywhere in the platform until the business names their signers.
 */
export const AUTHORIZATION_VISA_STEPS: readonly VisaStep[] = [
  { code: "VISA_DEMANDEUR", ordinal: 1 },
  { code: "VISA_CHEF_TRANSIT", ordinal: 2 },
  { code: "VISA_COORDONNATEUR", ordinal: 3 },
  { code: "VISA_OPERATIONS", ordinal: 4 }, // BLK-FIN-2 — signer unmapped
  { code: "VISA_TRESORIERE", ordinal: 5 },
  { code: "VISA_DAF", ordinal: 6 },
  { code: "VISA_DG", ordinal: 7 },
];

export const VOUCHER_VISA_STEPS: readonly VisaStep[] = [
  { code: "VISA_AGENT", ordinal: 1 }, // FINANCE_OFFICER, never CASHIER (DEC-C11)
  { code: "VISA_RECEPTION", ordinal: 2 }, // BLK-FIN-1 — signer unmapped
  { code: "VISA_COMPTABLE", ordinal: 3 },
  { code: "VISA_DAF", ordinal: 4 },
  { code: "VISA_DGA", ordinal: 5 },
  { code: "VISA_DG", ordinal: 6 },
];

/**
 * The visa steps whose signer role is a BUSINESS BLOCKER — deliberately unbound
 * in 11.0B (no guessing, no placeholder grant). A document reaching one of these
 * steps must halt honestly (« signataire non configuré »), never be auto-signed.
 */
export const UNBOUND_VISA_STEPS = ["VISA_RECEPTION", "VISA_OPERATIONS"] as const;

export function isUnboundVisaStep(code: string): boolean {
  return (UNBOUND_VISA_STEPS as readonly string[]).includes(code);
}

export function visaStepsFor(docType: ExpenseDocumentType): readonly VisaStep[] {
  return docType === "EXPENSE_AUTHORIZATION" ? AUTHORIZATION_VISA_STEPS : VOUCHER_VISA_STEPS;
}

// ============================================================ payment methods ==

/**
 * Voucher payment method vocabulary (DEC-C10) — the finance_request method set
 * WIDENED with FREE_MONEY (additive). The approved method is part of the signed
 * voucher; execution records the actual method (11.0E).
 */
export const EXPENSE_PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "CHEQUE",
  "WAVE",
  "ORANGE_MONEY",
  "FREE_MONEY",
  "OTHER",
] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

export function isExpensePaymentMethod(v: string): v is ExpensePaymentMethod {
  return (EXPENSE_PAYMENT_METHODS as readonly string[]).includes(v);
}

// ============================================================ material fields ==

/**
 * Material fields (DEC-C13): a change to any of these produces a NEW immutable
 * version and (from 11.0C) invalidates later visas. Harmless metadata edits do
 * not version. `isMaterialChange` is pure and used by the version action.
 */
export const MATERIAL_AUTHORIZATION_FIELDS = [
  "account_number",
  "registration_number",
  "expense_type",
  "weight_kg",
  "amount",
  "currency",
  "beneficiary",
  "reason",
  "file_id",
  "finance_request_id",
] as const;

export const MATERIAL_VOUCHER_FIELDS = [
  "account_number",
  "registration_number",
  "amount",
  "currency",
  "beneficiary",
  "reason",
  "payment_method",
] as const;

export function isMaterialChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.some((f) => (before[f] ?? null) !== (after[f] ?? null) && `${before[f] ?? ""}` !== `${after[f] ?? ""}`);
}

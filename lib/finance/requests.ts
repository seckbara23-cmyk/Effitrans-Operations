/**
 * Finance execution — pure contracts (Phase 9.0E). No I/O, client + server safe.
 * ---------------------------------------------------------------------------
 * The typed vocabulary and rules of the finance-request lifecycle (workflow
 * steps 20–26 seam): request statuses and their legal transitions, evidence
 * statuses, expense categories with their billing semantics, and the financial-
 * clearance evaluator. The server actions (./request-actions) delegate every
 * decision here, mirroring the process engine's state.ts discipline.
 *
 * THE core rule, stated once: A PROCESS DECISION IS NOT A PAYMENT. An approval
 * authorizes execution; only the explicit disbursement action records money
 * out; only a real payment record ever marks anything paid; only the customs
 * release contract ever clears customs.
 */

// ================================================================ statuses ====

export const FINANCE_REQUEST_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "RETURNED",
  "DISBURSED",
  "CANCELLED",
] as const;
export type FinanceRequestStatus = (typeof FINANCE_REQUEST_STATUSES)[number];

/**
 * Legal transitions. REJECTED / DISBURSED / CANCELLED are terminal; RETURNED
 * hands the request back for correction and may be resubmitted (→ REQUESTED).
 * There is deliberately NO transition into DISBURSED except from APPROVED —
 * that single edge, enforced by compare-and-set, is the duplicate-payment and
 * unauthorized-payment guard in one.
 */
const REQUEST_TRANSITIONS: Record<FinanceRequestStatus, FinanceRequestStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED", "RETURNED", "CANCELLED"],
  APPROVED: ["DISBURSED", "CANCELLED"],
  RETURNED: ["REQUESTED", "CANCELLED"],
  REJECTED: [],
  DISBURSED: [],
  CANCELLED: [],
};

export function canTransitionFinanceRequest(from: FinanceRequestStatus, to: FinanceRequestStatus): boolean {
  return REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isFinanceRequestStatus(v: string): v is FinanceRequestStatus {
  return (FINANCE_REQUEST_STATUSES as readonly string[]).includes(v);
}

export const REQUEST_STATUS_LABELS_FR: Readonly<Record<FinanceRequestStatus, string>> = {
  REQUESTED: "Demandé",
  APPROVED: "Approuvé — non décaissé",
  REJECTED: "Rejeté",
  RETURNED: "À corriger",
  DISBURSED: "Décaissé",
  CANCELLED: "Annulé",
};

// ================================================================ evidence ====

export const EVIDENCE_STATUSES = ["NONE", "SUBMITTED", "VERIFIED", "REJECTED"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** Submission never implies verification; a rejected proof may be resubmitted. */
const EVIDENCE_TRANSITIONS: Record<EvidenceStatus, EvidenceStatus[]> = {
  NONE: ["SUBMITTED"],
  SUBMITTED: ["VERIFIED", "REJECTED"],
  REJECTED: ["SUBMITTED"],
  VERIFIED: [],
};

export function canTransitionEvidence(from: EvidenceStatus, to: EvidenceStatus): boolean {
  return EVIDENCE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const EVIDENCE_STATUS_LABELS_FR: Readonly<Record<EvidenceStatus, string>> = {
  NONE: "Aucun justificatif",
  SUBMITTED: "Justificatif transmis — à vérifier",
  VERIFIED: "Justificatif vérifié",
  REJECTED: "Justificatif rejeté",
};

// =============================================================== categories ====

export type FinanceCategory = "CUSTOMS_DUTY" | "AUTHORITY_FEE" | "SUPPLIER_EXPENSE" | "INTERNAL_COST" | "OTHER";

export type FinanceCategoryDef = {
  code: FinanceCategory;
  labelFr: string;
  /**
   * Whether this expense class is customer-reimbursable BY DEFAULT (the request
   * can override per dossier). Internal costs never default to billable —
   * "do not treat every disbursement as automatically billable".
   */
  reimbursableByDefault: boolean;
};

export const FINANCE_CATEGORIES: readonly FinanceCategoryDef[] = [
  { code: "CUSTOMS_DUTY", labelFr: "Droits et taxes de douane", reimbursableByDefault: true },
  { code: "AUTHORITY_FEE", labelFr: "Frais d'autorité / redevance", reimbursableByDefault: true },
  { code: "SUPPLIER_EXPENSE", labelFr: "Dépense fournisseur / tiers", reimbursableByDefault: false },
  { code: "INTERNAL_COST", labelFr: "Coût interne d'exploitation", reimbursableByDefault: false },
  { code: "OTHER", labelFr: "Autre dépense", reimbursableByDefault: false },
] as const;

export function isFinanceCategory(v: string): v is FinanceCategory {
  return FINANCE_CATEGORIES.some((c) => c.code === v);
}

export function financeCategoryLabelFr(code: string): string {
  return FINANCE_CATEGORIES.find((c) => c.code === code)?.labelFr ?? code;
}

/** Same closed vocabulary as public.payment.method — no parallel method list. */
export const DISBURSEMENT_METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE", "WAVE", "ORANGE_MONEY", "OTHER"] as const;

export function isDisbursementMethod(v: string): boolean {
  return (DISBURSEMENT_METHODS as readonly string[]).includes(v);
}

// ==================================================== financial clearance ====

export type ClearanceRequestView = {
  status: FinanceRequestStatus;
  evidenceStatus: EvidenceStatus;
};

export type ClearanceInput = {
  requests: ClearanceRequestView[];
  /** OPEN/ACKNOWLEDGED blockers in the finance categories (PAYMENT_PENDING…). */
  openFinanceBlockers: number;
  /** A CONTINUE_BEFORE_PAYMENT decision still awaiting finalization. */
  pendingPaymentDecision: boolean;
  /** 'none' | 'draft' | 'validated' | 'issued' — the dossier's invoice state. */
  invoiceState: "none" | "draft" | "validated" | "issued";
  /** An authorized human explicitly deferred invoicing for this dossier. */
  invoiceIntentionallyDeferred: boolean;
};

export type ClearanceMissing =
  | "requests_awaiting_review"
  | "approved_not_disbursed"
  | "evidence_missing_or_unverified"
  | "open_finance_blockers"
  | "pending_payment_decision"
  | "invoice_not_generated";

export type ClearanceResult = { ready: boolean; missing: ClearanceMissing[] };

export const CLEARANCE_MISSING_LABELS_FR: Readonly<Record<ClearanceMissing, string>> = {
  requests_awaiting_review: "Des demandes de fonds attendent une revue Finance.",
  approved_not_disbursed: "Des demandes approuvées n'ont pas encore été décaissées.",
  evidence_missing_or_unverified: "Des décaissements attendent un justificatif vérifié.",
  open_finance_blockers: "Des points bloquants financiers restent ouverts.",
  pending_payment_decision: "Une décision « continuer avant paiement » est en attente.",
  invoice_not_generated: "Aucune facture générée (ni report explicite de facturation).",
};

/**
 * Financial clearance — PURE. Ready only when: no request awaits review or
 * disbursement, every disbursed request carries VERIFIED evidence, no finance
 * blocker is open, no payment decision is pending, and an invoice exists (or
 * invoicing was explicitly deferred). Clearance asserts NOTHING it cannot see:
 * it never claims the customer paid, never completes delivery, never clears
 * customs — it only says Finance's own work on this dossier is done.
 */
export function evaluateFinancialClearance(input: ClearanceInput): ClearanceResult {
  const missing: ClearanceMissing[] = [];

  if (input.requests.some((r) => r.status === "REQUESTED" || r.status === "RETURNED")) {
    missing.push("requests_awaiting_review");
  }
  if (input.requests.some((r) => r.status === "APPROVED")) {
    missing.push("approved_not_disbursed");
  }
  if (input.requests.some((r) => r.status === "DISBURSED" && r.evidenceStatus !== "VERIFIED")) {
    missing.push("evidence_missing_or_unverified");
  }
  if (input.openFinanceBlockers > 0) missing.push("open_finance_blockers");
  if (input.pendingPaymentDecision) missing.push("pending_payment_decision");
  if (input.invoiceState === "none" && !input.invoiceIntentionallyDeferred) {
    missing.push("invoice_not_generated");
  }

  return { ready: missing.length === 0, missing };
}

/** Blocker categories that gate financial clearance. */
export const FINANCE_BLOCKER_CATEGORIES = ["PAYMENT_PENDING", "PAYMENT_REJECTED"] as const;

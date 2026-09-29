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
  /**
   * The DRAFT's total, from `invoiceTotals` — the canonical calculation, never
   * a second one (STEP20-INVOICE-02).
   *
   * Required, and required to be supplied rather than defaulted, because the
   * whole point of this field is to fail CLOSED: a caller that forgets it must
   * lose the clearance, not win it. `null` where there is no draft to total —
   * a VALIDATED or ISSUED invoice has already passed `validateIssuance`, which
   * refuses a zero, negative or oversized total, so its value is established
   * and is not re-litigated here.
   */
  invoiceTotal: number | null;
  /** An authorized human explicitly deferred invoicing for this dossier. */
  invoiceIntentionallyDeferred: boolean;
};

export type ClearanceMissing =
  | "requests_awaiting_review"
  | "approved_not_disbursed"
  | "evidence_missing_or_unverified"
  | "open_finance_blockers"
  | "pending_payment_decision"
  | "invoice_not_generated"
  /**
   * STEP20-INVOICE-02 — an invoice ROW exists but carries no money.
   *
   * Its own code rather than `invoice_not_generated`, because the two need
   * different acts: one operator must create an invoice, the other must add a
   * billable line to the one they already have. Telling the second « aucune
   * facture générée » about a draft sitting in front of them is how a correct
   * refusal reads as a broken platform.
   */
  | "invoice_without_value";

export type ClearanceResult = { ready: boolean; missing: ClearanceMissing[] };

export const CLEARANCE_MISSING_LABELS_FR: Readonly<Record<ClearanceMissing, string>> = {
  requests_awaiting_review: "Des demandes de fonds attendent une revue Finance.",
  approved_not_disbursed: "Des demandes approuvées n'ont pas encore été décaissées.",
  evidence_missing_or_unverified: "Des décaissements attendent un justificatif vérifié.",
  open_finance_blockers: "Des points bloquants financiers restent ouverts.",
  pending_payment_decision: "Une décision « continuer avant paiement » est en attente.",
  invoice_not_generated: "Aucune facture générée (ni report explicite de facturation).",
  invoice_without_value:
    "Facture en brouillon sans montant : ajoutez au moins une ligne facturable.",
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
  missing.push(...invoiceConditionShortfall(input));

  return { ready: missing.length === 0, missing };
}

/**
 * The invoice half of financial clearance (STEP20-INVOICE-02).
 *
 * THE FAIL-OPEN THIS CLOSES. The rule was `invoiceState === "none"`, and an
 * invoice ROW is free to create: `createInvoice` inserts a DRAFT with no lines,
 * no number and no total. So on EFT-IMP-2026-00013 a draft carrying 0 XOF
 * satisfied « une facture », and the dossier reported « Toutes les conditions
 * financières sont réunies » beside it. Nothing else on the panel was wrong —
 * the total really was zero, and the clearance really did say yes. The
 * existence of an empty row was being read as an invoice having been produced.
 *
 * WHAT IS, AND IS NOT, DECIDED HERE. Phase 9.0E ratifies the requirement as
 * « an invoice (or an explicit, reasoned invoicing deferral) » — it does NOT
 * say VALIDATED or ISSUED. So a DRAFT still qualifies, exactly as before; what
 * changes is only that it must be an invoice in the economic sense rather than
 * an empty row. Whether a positive DRAFT should be enough, or whether clearance
 * should wait for Finance's validation at step 21, is a question governance has
 * not answered — and this does not answer it either.
 *
 * VALIDATED and ISSUED are not re-checked: both have already passed
 * `validateIssuance`, which refuses a zero, negative or oversized total before
 * an official number is allocated. Re-deriving their worth here would be a
 * second monetary opinion about a figure the issuance path already settled.
 */
export function invoiceConditionShortfall(
  input: Pick<ClearanceInput, "invoiceState" | "invoiceTotal" | "invoiceIntentionallyDeferred">,
): ClearanceMissing[] {
  // An authorized, reasoned deferral answers the question outright — unchanged.
  if (input.invoiceIntentionallyDeferred) return [];
  if (input.invoiceState === "none") return ["invoice_not_generated"];
  if (input.invoiceState !== "draft") return [];
  // A draft with no lines totals 0; a miskeyed one can total below 0. Neither
  // is an invoice. `null` — a caller that did not total it — fails CLOSED.
  return (input.invoiceTotal ?? 0) > 0 ? [] : ["invoice_without_value"];
}

/** Blocker categories that gate financial clearance. */
export const FINANCE_BLOCKER_CATEGORIES = ["PAYMENT_PENDING", "PAYMENT_REJECTED"] as const;

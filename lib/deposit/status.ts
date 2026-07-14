/**
 * Physical invoice deposit — state machine (Phase 5.0D). PURE.
 * ---------------------------------------------------------------------------
 * A deposit is an ERRAND, not a financial state. It never touches
 * invoice.status: an invoice can be emailed, in a courier's bag, deposited and
 * still entirely unpaid. Conflating the two would corrupt the payment model, so
 * the two machines are kept strictly separate.
 */

export const DEPOSIT_STATUSES = [
  "PREPARATION_PENDING",
  "READY_FOR_COURIER",
  "ASSIGNED",
  "IN_TRANSIT",
  "DEPOSITED",
  "PROOF_SUBMITTED",
  "PROOF_ACCEPTED",
  "PROOF_REJECTED",
  "HANDED_TO_COLLECTIONS",
  "CANCELLED",
] as const;

export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const DEPOSIT_LABEL_FR: Record<DepositStatus, string> = {
  PREPARATION_PENDING: "Préparation en attente",
  READY_FOR_COURIER: "Prêt pour le coursier",
  ASSIGNED: "Affecté à un coursier",
  IN_TRANSIT: "En cours de remise",
  DEPOSITED: "Déposé chez le client",
  PROOF_SUBMITTED: "Preuve transmise",
  PROOF_ACCEPTED: "Preuve validée",
  PROOF_REJECTED: "Preuve rejetée",
  HANDED_TO_COLLECTIONS: "Remis au recouvrement",
  CANCELLED: "Annulé",
};

/**
 * PROOF_REJECTED returns to the COURIER (IN_TRANSIT/DEPOSITED), not to a dead end:
 * a rejected proof is a correction loop, exactly like the process engine's.
 */
const ALLOWED: Record<DepositStatus, DepositStatus[]> = {
  PREPARATION_PENDING: ["READY_FOR_COURIER", "CANCELLED"],
  READY_FOR_COURIER: ["ASSIGNED", "CANCELLED"],
  // A declined or reassigned courier returns the package to Administration.
  ASSIGNED: ["IN_TRANSIT", "READY_FOR_COURIER", "CANCELLED"],
  // A FAILED deposit returns the package to Administration (READY_FOR_COURIER),
  // it does not vanish and it does not become a deposit.
  IN_TRANSIT: ["DEPOSITED", "READY_FOR_COURIER", "ASSIGNED", "CANCELLED"],
  DEPOSITED: ["PROOF_SUBMITTED", "CANCELLED"],
  PROOF_SUBMITTED: ["PROOF_ACCEPTED", "PROOF_REJECTED"],
  // Rejected proof goes BACK to the courier to be redone.
  PROOF_REJECTED: ["DEPOSITED", "IN_TRANSIT", "CANCELLED"],
  PROOF_ACCEPTED: ["HANDED_TO_COLLECTIONS"],
  HANDED_TO_COLLECTIONS: [],
  CANCELLED: [],
};

export function canTransitionDeposit(from: DepositStatus, to: DepositStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function isDepositStatus(v: string): v is DepositStatus {
  return (DEPOSIT_STATUSES as readonly string[]).includes(v);
}

/** The deposit is finished and the receivable may be chased. */
export function depositComplete(status: DepositStatus): boolean {
  return status === "HANDED_TO_COLLECTIONS";
}

/** The courier may act on it (and only the assignee ever gets this far). */
export function courierActionable(status: DepositStatus): boolean {
  return status === "ASSIGNED" || status === "IN_TRANSIT" || status === "PROOF_REJECTED";
}

export type ProofInput = {
  proofDocumentId: string | null;
  recipientName: string | null;
  depositedAt: string | null;
};

/**
 * A deposit cannot be proven without a document, a recipient AND a date. This is
 * the "no generic complete checkbox" rule: evidence or nothing.
 */
export function proofComplete(p: ProofInput): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!p.proofDocumentId) missing.push("proof_document");
  if (!p.recipientName || p.recipientName.trim() === "") missing.push("recipient_name");
  if (!p.depositedAt) missing.push("deposited_at");
  return { ok: missing.length === 0, missing };
}

// ---------------------------------------------- explicit acceptance (5.0D-3) ----

/**
 * ACCEPTANCE IS EXPLICIT. Assignment alone starts nothing: a courier must accept
 * the mission before they can depart. Modelled as a timestamp rather than a new
 * status, so the shipped status enum is untouched — "assigned but not yet
 * accepted" is ASSIGNED + accepted_at null.
 */
export type AssignmentView = {
  status: DepositStatus;
  courierUserId: string | null;
  acceptedAt: string | null;
};

/** Only the ASSIGNED courier may accept, and only once (idempotent thereafter). */
export function canAccept(a: AssignmentView, userId: string): boolean {
  return a.status === "ASSIGNED" && a.courierUserId === userId && a.acceptedAt === null;
}

/** Already accepted => a repeat acceptance is a harmless no-op, not an error. */
export function alreadyAccepted(a: AssignmentView, userId: string): boolean {
  return a.status === "ASSIGNED" && a.courierUserId === userId && a.acceptedAt !== null;
}

/** A courier may only depart on a mission they were assigned AND have accepted. */
export function canStartDeposit(a: AssignmentView, userId: string): boolean {
  return a.status === "ASSIGNED" && a.courierUserId === userId && a.acceptedAt !== null;
}

/** Only the assigned courier acts, and only in their own actionable states. */
export function isAssignedCourier(a: AssignmentView, userId: string): boolean {
  return a.courierUserId === userId;
}

/**
 * Reassigning a courier who has already ACCEPTED requires a reason: someone had
 * the package and is losing it, and the chain must say why.
 */
export function reassignmentNeedsReason(a: AssignmentView): boolean {
  return a.acceptedAt !== null;
}

// ------------------------------------------------------------- eligibility ----

export type EligibilityInput = {
  invoiceStatus: string;
  invoiceValidatedAt: string | null;
  clientRequiresDeposit: boolean;
  activeDepositExists: boolean;
};

export type EligibilityError =
  | "invoice_not_validated"
  | "invoice_not_issued"
  | "deposit_not_required"
  | "active_deposit_exists";

export type Eligibility =
  | { eligible: true }
  /** Explicitly configured as unnecessary — reported, never silently skipped. */
  | { eligible: false; notApplicable: true; error: "deposit_not_required" }
  | { eligible: false; notApplicable: false; error: EligibilityError };

/**
 * May a physical deposit workflow begin?
 *
 * A deposit is required only when the CLIENT is explicitly configured for it. When
 * it is not required we report `notApplicable` and create nothing — the closure
 * gate then shows those requirements as not-applicable rather than pretending they
 * were satisfied.
 */
export function evaluateEligibility(input: EligibilityInput): Eligibility {
  if (!input.clientRequiresDeposit) {
    return { eligible: false, notApplicable: true, error: "deposit_not_required" };
  }
  if (!input.invoiceValidatedAt) {
    return { eligible: false, notApplicable: false, error: "invoice_not_validated" };
  }
  // ISSUED means the validated invoice was actually EMAILED (Phase 5.0D-2). A
  // physical deposit follows the send; it never precedes it.
  if (input.invoiceStatus !== "ISSUED" && input.invoiceStatus !== "PARTIALLY_PAID") {
    return { eligible: false, notApplicable: false, error: "invoice_not_issued" };
  }
  if (input.activeDepositExists) {
    return { eligible: false, notApplicable: false, error: "active_deposit_exists" };
  }
  return { eligible: true };
}

// -------------------------------------------------- courier workspace state ----

export type CourierSection =
  | "new_assignment"
  | "awaiting_acceptance"
  | "ready_to_depart"
  | "in_progress"
  | "deposit_details_required"
  | "proof_upload_required"
  | "proof_under_review"
  | "proof_rejected"
  | "completed";

/** Which section of the Courier's mobile workspace this deposit belongs in. */
export function courierSection(
  a: AssignmentView,
  hasDepositDetails: boolean,
  hasProof: boolean,
): CourierSection {
  switch (a.status) {
    case "ASSIGNED":
      return a.acceptedAt === null ? "awaiting_acceptance" : "ready_to_depart";
    case "IN_TRANSIT":
      return hasDepositDetails ? "proof_upload_required" : "in_progress";
    case "DEPOSITED":
      return hasProof ? "proof_upload_required" : "deposit_details_required";
    case "PROOF_SUBMITTED":
      return "proof_under_review";
    case "PROOF_REJECTED":
      return "proof_rejected";
    case "PROOF_ACCEPTED":
    case "HANDED_TO_COLLECTIONS":
      return "completed";
    default:
      return "new_assignment";
  }
}

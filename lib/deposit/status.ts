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
  ASSIGNED: ["IN_TRANSIT", "READY_FOR_COURIER", "CANCELLED"],
  IN_TRANSIT: ["DEPOSITED", "ASSIGNED", "CANCELLED"],
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

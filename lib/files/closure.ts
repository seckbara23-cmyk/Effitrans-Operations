/**
 * Dossier closure requirements — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * ONE definition of "may this dossier be closed", used by the lifecycle display
 * AND by the server guard in `transitionFile`. That is the whole point: the
 * lifecycle already SHOWED an `await_payment` gate on the archive stage, but
 * nothing enforced it — `DELIVERED → CLOSED` was refused only when customs was
 * required and unreleased. A dossier with an unpaid invoice, or with a payment
 * recorded but never verified, closed without complaint.
 *
 * A displayed gate that the server does not enforce is not a control; it is a
 * suggestion. So the rule lives here once and both sides call it.
 *
 * PAYMENT VERIFICATION IS PART OF CLOSURE. Recording a payment is a maker
 * action; verifying it is the checker's. Closing on an unverified payment would
 * let one person both receive and confirm the money — exactly the separation
 * the payment maker-checker exists to enforce.
 */

export type ClosureBlockerCode =
  | "customs_not_released"
  | "delivery_incomplete"
  | "no_invoice"
  | "invoice_outstanding"
  | "payment_unverified";

export type ClosureFactsInput = {
  fileType: string;
  /** null when the dossier has no customs leg at all. */
  customs: { status: string; required: boolean } | null;
  /** null when the dossier has no transport leg. */
  transport: { status: string } | null;
  /** Every invoice on the dossier, VOID included — filtered here, once. */
  invoices: readonly { status: string; balance: number }[];
  /**
   * Every live (non-reversed) payment carries its verification status.
   * An empty list means nothing was ever paid.
   */
  payments: readonly { verified: boolean }[];
};

/** French, operator-facing. Never a generic failure when the reason is known. */
export const CLOSURE_BLOCKER_LABEL_FR: Readonly<Record<ClosureBlockerCode, string>> = {
  customs_not_released: "La mainlevée douanière n'est pas obtenue.",
  delivery_incomplete: "La livraison n'est pas terminée.",
  no_invoice: "Aucune facture émise pour ce dossier.",
  invoice_outstanding: "Une facture reste à régler.",
  payment_unverified: "Un paiement enregistré n'est pas encore vérifié.",
};

const CUSTOMS_TYPES = new Set(["IMP", "EXP"]);

/**
 * Every unmet closure requirement, most fundamental first. Empty = closable.
 *
 * Returning the LIST rather than a boolean is deliberate: the operator is told
 * what is actually outstanding, and a caller that wants a yes/no just checks
 * `.length === 0`.
 */
export function closureBlockers(input: ClosureFactsInput): ClosureBlockerCode[] {
  const blockers: ClosureBlockerCode[] = [];

  // ---- customs (the pre-existing Phase 1.9 guard, unchanged in meaning) ----
  // Only IMP/EXP with a REQUIRED record. `required = false` is the documented
  // escape hatch, and a cancelled leg is not outstanding work.
  if (CUSTOMS_TYPES.has(input.fileType) && input.customs && input.customs.required) {
    const s = input.customs.status;
    if (s !== "RELEASED" && s !== "CANCELLED") blockers.push("customs_not_released");
  }

  // ---- delivery ------------------------------------------------------------
  // Only when a transport leg exists. A cancelled transport is not outstanding.
  if (input.transport) {
    const s = input.transport.status;
    const delivered = s === "DELIVERED" || s === "POD_RECEIVED" || s === "CANCELLED";
    if (!delivered) blockers.push("delivery_incomplete");
  }

  // ---- money ---------------------------------------------------------------
  const billable = input.invoices.filter((i) => i.status !== "VOID");
  if (billable.length === 0) {
    blockers.push("no_invoice");
  } else if (billable.some((i) => i.balance > 0 || i.status === "DRAFT")) {
    blockers.push("invoice_outstanding");
  }

  // Verification is separate from settlement: a zero balance reached through an
  // unverified payment is not a settled dossier.
  if (input.payments.length > 0 && input.payments.some((p) => !p.verified)) {
    blockers.push("payment_unverified");
  }

  return blockers;
}

export function canCloseDossier(input: ClosureFactsInput): boolean {
  return closureBlockers(input).length === 0;
}

/** The first blocker's French message, for a single-line refusal. */
export function closureRefusalFr(blockers: readonly ClosureBlockerCode[]): string | null {
  return blockers.length > 0 ? CLOSURE_BLOCKER_LABEL_FR[blockers[0]] : null;
}

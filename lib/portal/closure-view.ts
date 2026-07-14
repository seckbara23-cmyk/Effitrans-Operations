/**
 * Portal-safe post-delivery state (Phase 5.0D-5, Deliverable 6). PURE.
 * ---------------------------------------------------------------------------
 * Maps the INTERNAL post-delivery chain onto the six states a customer may see.
 *
 * WHAT THE CUSTOMER NEVER SEES, and cannot infer from this:
 *   the physical-deposit chain          (prepared / courier / deposited / proof)
 *   the proof-review history            (accepted / rejected / who reviewed)
 *   the collector's identity            or any follow-up note
 *   promises, disputes, escalations     or the priority score
 *   closure blockers                    or the maker-checker history
 *
 * A dossier is reported CLOSED only when the explicit, authorized close action has
 * actually succeeded — never inferred from payment, from delivery, or from a
 * status label. Paying in full does not make a dossier "closed" to the client any
 * more than it does internally.
 */

export const PORTAL_POST_DELIVERY_STATES = [
  "delivered",
  "invoice_issued",
  "payment_pending",
  "partially_paid",
  "paid",
  "closed",
] as const;

export type PortalPostDeliveryState = (typeof PORTAL_POST_DELIVERY_STATES)[number];

export const PORTAL_STATE_LABEL_FR: Record<PortalPostDeliveryState, string> = {
  delivered: "Livré",
  invoice_issued: "Facture émise",
  payment_pending: "Paiement en attente",
  partially_paid: "Partiellement payée",
  paid: "Payée",
  closed: "Dossier clôturé",
};

export type PortalClosureInput = {
  /** operational_file.status — the shipped lifecycle. */
  fileStatus: string;
  /** invoice.status. A VALIDATED-but-unsent invoice must NOT be treated as issued. */
  invoiceStatus: string | null;
  outstandingBalance: number;
  /** True only when the explicit close action succeeded. */
  processClosed: boolean;
};

/**
 * The customer-safe state. Deliberately conservative: when in doubt it reports the
 * EARLIER state rather than implying progress that has not happened.
 */
export function portalPostDeliveryState(input: PortalClosureInput): PortalPostDeliveryState {
  // Closure is only ever what the close action says it is.
  if (input.processClosed || input.fileStatus === "CLOSED") return "closed";

  const s = input.invoiceStatus;

  // DRAFT and VALIDATED are internal: a validated-but-unsent invoice does not
  // exist as far as the client is concerned (portal RLS hides it too).
  if (!s || s === "DRAFT" || s === "VALIDATED" || s === "VOID") return "delivered";

  if (s === "PAID" || input.outstandingBalance <= 0) return "paid";
  if (s === "PARTIALLY_PAID") return "partially_paid";
  if (s === "ISSUED") return input.outstandingBalance > 0 ? "payment_pending" : "paid";

  return "invoice_issued";
}

/** True when the client may be shown this invoice at all. Mirrors the portal RLS. */
export function invoiceVisibleToClient(invoiceStatus: string | null): boolean {
  return invoiceStatus === "ISSUED" || invoiceStatus === "PARTIALLY_PAID" || invoiceStatus === "PAID";
}

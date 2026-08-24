/**
 * C-3 — declared absence of evidence. PURE (no I/O), so the rule is testable.
 * ---------------------------------------------------------------------------
 * RATIFIED 2026-08-24. Three of step 3's four required documents exist only when
 * the dossier actually has that thing — a third-party payable, an advance
 * expense, an Effitrans-run transport — so enforcing them unconditionally made
 * legitimate dossiers impossible to complete. The remedy is the idiom the
 * platform already ratified for cotation (« Sans devis »): not a skip and not an
 * exception, but a DECLARATION on the record, with a reason and an author.
 *
 * The declarable set is deliberately CLOSED and small. It is enforced here, in
 * the server action, and again by a CHECK constraint in migration 123 — three
 * layers, because "which evidence may be waived" is a business rule and a future
 * caller must not be able to widen it by forgetting.
 */

/** Evidence keys an authorised actor may declare inapplicable, with a motif. */
export const DECLARABLE_EVIDENCE_KEYS: readonly string[] = [
  "VENDOR_INVOICE",
  "SPENDING_AUTHORIZATION",
  "TRANSPORT_REQUEST",
];

/**
 * Never declarable, and named explicitly rather than left implicit:
 *   • BORDEREAU_LIVRAISON — the transport document the dossier is built on;
 *   • RECEIPT / PAYMENT_PROOF — step 18's financial completeness evidence,
 *     which is the whole point of the completeness control.
 */
export const NON_DECLARABLE_EVIDENCE_KEYS: readonly string[] = [
  "BORDEREAU_LIVRAISON",
  "RECEIPT",
  "PAYMENT_PROOF",
];

export function isDeclarableEvidence(key: string): boolean {
  return DECLARABLE_EVIDENCE_KEYS.includes(key);
}

export const MAX_ABSENCE_REASON = 280;

export type AbsenceReasonCheck = { ok: true; reason: string } | { ok: false; error: string };

/** A motif is mandatory and must say something. Trimmed and bounded. */
export function validateAbsenceReason(raw: string | null | undefined): AbsenceReasonCheck {
  const reason = (raw ?? "").replace(/\s+/g, " ").trim();
  if (reason.length === 0) return { ok: false, error: "reason_required" };
  return { ok: true, reason: reason.slice(0, MAX_ABSENCE_REASON) };
}

/** French label for a declared absence, shown wherever the evidence would be. */
export function absenceLabelFr(reason: string): string {
  return `Sans objet — ${reason}`;
}

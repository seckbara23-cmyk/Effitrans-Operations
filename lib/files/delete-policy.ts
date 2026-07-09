/**
 * Dossier delete policy (Phase 3.2A). PURE — no I/O, unit-testable.
 * ---------------------------------------------------------------------------
 * A dossier may be HARD-deleted only when it is an empty shell: no invoices,
 * documents, customs record, transport record or tasks. Every FK to
 * operational_file is ON DELETE CASCADE / SET NULL, so a hard delete would
 * silently destroy those business records — this guard is what prevents it. When
 * the dossier is not empty the UI must instead offer cancel/close.
 *
 * The DB counting lives in the server action (lib/files/actions.ts); this module
 * only decides, so the rule can be tested without a database.
 */
export type DossierOperationCounts = {
  /** invoices + billing charges + payments (any financial record) */
  finance: number;
  documents: number;
  customs: number;
  transport: number;
  tasks: number;
};

/** True when the dossier carries any operational/business record. */
export function hasBlockingOperations(c: DossierOperationCounts): boolean {
  return (
    c.finance > 0 ||
    c.documents > 0 ||
    c.customs > 0 ||
    c.transport > 0 ||
    c.tasks > 0
  );
}

export type DeleteDecision =
  | { allowed: true }
  | { allowed: false; reason: "has_operations" };

/** Whether a hard delete is permitted for a dossier with these record counts. */
export function evaluateHardDelete(c: DossierOperationCounts): DeleteDecision {
  return hasBlockingOperations(c) ? { allowed: false, reason: "has_operations" } : { allowed: true };
}

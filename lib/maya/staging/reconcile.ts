/**
 * MAYA migration staging — reconciliation (MAYA-P0.5-C). PURE. No I/O.
 * ---------------------------------------------------------------------------
 * The property a migration lives or dies by:
 *
 *     SOURCE ROWS = READY + WARNINGS + REJECTED + DUPLICATES
 *
 * A row that vanishes between the export and the review is the failure mode
 * nobody notices until the books disagree, so the four outcome statuses
 * PARTITION the batch and this module proves the sum. The database enforces
 * the same equation as a CHECK on maya_import_batch (`maya_batch_reconciles`)
 * — belt and braces, because a report that computes its own totals can agree
 * with itself while disagreeing with the rows.
 *
 * `unresolved` is deliberately NOT part of the sum: it is an overlay counting
 * WARNING rows whose client or dossier mère could not be matched.
 */
import type { BatchReconciliation, MayaRowStatus } from "./types";

export function reconcileBatch(
  statuses: readonly MayaRowStatus[],
  unresolvedCount = 0,
): BatchReconciliation {
  const count = (s: MayaRowStatus) => statuses.filter((x) => x === s).length;
  const valid = count("VALID");
  const warning = count("WARNING");
  const rejected = count("REJECTED");
  const duplicate = count("DUPLICATE");
  const sourceRows = statuses.length;

  return {
    sourceRows,
    valid,
    warning,
    rejected,
    duplicate,
    unresolved: unresolvedCount,
    // PENDING rows are unvalidated, so a batch mid-validation is NOT balanced —
    // and says so rather than reporting a tidy, wrong total.
    balanced: sourceRows === valid + warning + rejected + duplicate,
  };
}

/**
 * The batch outcome implied by its rows. Mirrors the states in types.ts:
 * a batch with any rejected row is REJECTED (a human must look), a batch with
 * warnings or duplicates is READY_WITH_WARNINGS, and only a wholly clean batch
 * is READY. « Ready » here means "reviewable", never "importable" — no apply
 * path exists in this phase.
 */
export function batchOutcome(r: BatchReconciliation): "READY" | "READY_WITH_WARNINGS" | "REJECTED" {
  if (!r.balanced) return "REJECTED";
  if (r.rejected > 0) return "REJECTED";
  if (r.warning > 0 || r.duplicate > 0) return "READY_WITH_WARNINGS";
  return "READY";
}

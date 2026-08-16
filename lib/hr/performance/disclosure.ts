/**
 * HR-B2 — identity-scoped C3 disclosure (Q2, ratified). PURE. No I/O.
 * ---------------------------------------------------------------------------
 * HR-6 classed evaluation prose C3 and gated it on the org-wide
 * `hr:sensitive:read`. That gate is identity-BLIND, with a consequence the
 * audit named: an employee could not read their own finalized review, and the
 * manager of record could not read the self-assessment they were asked to
 * review — yet acknowledging and reviewing both presuppose reading.
 *
 * Effitrans ratified two NARROW lanes. They are disclosure rules about YOUR OWN
 * ROW; they neither grant nor imply `hr:sensitive:read`, which keeps its own
 * separate, still-ungranted life as the broad organizational authority.
 *
 *   OWN RECORD — the employee reads the prose of their own evaluation,
 *                including their finalized review.
 *   MANAGER OF RECORD — the manager SNAPSHOTTED on the evaluation reads that
 *                employee's self-assessment (Q2, "for purposes of performing
 *                the manager review") and the review they themselves authored.
 *                They do NOT read HR's moderation note or final summary: those
 *                are the finalizer's words about the review, not the review.
 *
 * The snapshot is the authority, never a live re-derivation: a manager who has
 * since moved on cannot reach back into a cycle, and a newly-assigned manager
 * inherits no half-finished review. Everyone else sees the WORKFLOW only.
 */

/** The three prose families, separated because they disclose differently. */
export type DisclosureScope = {
  /** self_comments — the employee's own words. */
  self: boolean;
  /** manager_comments, strengths, development, recommended_actions. */
  manager: boolean;
  /** moderation_note, final_summary — the finalizer's words. */
  hr: boolean;
};

export const NO_DISCLOSURE: DisclosureScope = { self: false, manager: false, hr: false };
export const FULL_DISCLOSURE: DisclosureScope = { self: true, manager: true, hr: true };

export type DisclosureInput = {
  /** The org-wide sensitive authority. Unchanged, still separate. */
  canReadSensitive: boolean;
  /** The viewer's linked ACTIVE employee id, when they have one. */
  viewerEmployeeId: string | null;
  /** The evaluation being read. */
  evaluation: { employeeId: string; managerEmployeeId: string | null };
};

/** What prose may this viewer see on THIS evaluation? */
export function evaluationDisclosure(input: DisclosureInput): DisclosureScope {
  if (input.canReadSensitive) return FULL_DISCLOSURE;
  const viewer = input.viewerEmployeeId;
  if (!viewer) return NO_DISCLOSURE;
  // Own record — the whole file, including the finalized review.
  if (viewer === input.evaluation.employeeId) return FULL_DISCLOSURE;
  // Manager OF RECORD — the self-assessment they must review, and their own
  // words. Never HR's moderation or final summary.
  if (input.evaluation.managerEmployeeId !== null && viewer === input.evaluation.managerEmployeeId) {
    return { self: true, manager: true, hr: false };
  }
  return NO_DISCLOSURE;
}

/** True when the viewer has ANY lane on this evaluation — used to decide
 *  whether the C3 columns may be fetched for it at all. */
export function hasAnyDisclosure(scope: DisclosureScope): boolean {
  return scope.self || scope.manager || scope.hr;
}

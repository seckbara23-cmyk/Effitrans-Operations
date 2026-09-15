/**
 * The Déclarant assignment pair (UAT-DECLARANT-START-01) — PURE, client-safe.
 * ---------------------------------------------------------------------------
 * Official step 5 « Chef de Transit — réception et affectation du Déclarant »
 * and official step 6 « Déclarant — préparer le dossier de dédouanement » are
 * one act and its consequence. The registry says so: step 5's `completionRule`
 * is `declarant_assigned`, and step 6's only prerequisite is step 5.
 *
 * THE DEFECT THIS CLOSES (EFT-IMP-2026-00012, diagnosed read-only 2026-09-15).
 * `assignTransitStep` wrote step 6's `assigned_user_id` and nothing else, so
 * step 5 — the step whose product that assignment IS — stayed AVAILABLE. Step
 * 6 was therefore never promoted, and the assigned Déclarant, correctly
 * identified and correctly permissioned, opened the dossier to a « Démarrer »
 * she could not press and a « Créer le dossier douane » that answered
 * « Cette étape n'est pas encore ouverte. » Every surface was right; the act
 * was half-finished. The dossier sat that way for five days until the Chef
 * happened to press Démarrer/Terminer on step 5 by hand.
 *
 * TWO RULES, ONE FACT, STATED ONCE HERE:
 *   • `declarantOf` — who the dossier's Déclarant IS: the assignee of the live
 *     preparation row. There is no second column, no second table and no
 *     second source of truth (`lib/workflow/access` holds a dormant
 *     ledger-backed writer with no caller; this does not wake it).
 *   • `declarantRequiredRefusal` — step 5 may not be closed while nobody is
 *     named, because closing it opens the Déclarant's step to no one. The
 *     engine asks this at `submitStep`; nothing else may restate it.
 */

/** Official step 5 — the Chef de Transit's assignment act. */
export const DECLARANT_ASSIGNMENT_STEP = "transit_declarant_assignment";
/** Official step 6 — the Déclarant's preparation, and the assignment's target. */
export const DECLARANT_PREPARATION_STEP = "customs_preparation";

/** The minimum of an execution row these rules need. */
export type StepAssignmentView = {
  stepKey: string;
  state: string;
  assignedUserId?: string | null;
};

/** A rejected or cancelled attempt is history, never the live row. */
const isLive = (e: StepAssignmentView): boolean =>
  e.state !== "REJECTED" && e.state !== "CANCELLED";

/**
 * The dossier's current Déclarant — the assignee of the live preparation row,
 * or null when Transit has named nobody yet.
 */
export function declarantOf(executions: readonly StepAssignmentView[]): string | null {
  const prep = executions.find((e) => e.stepKey === DECLARANT_PREPARATION_STEP && isLive(e));
  const assignee = (prep?.assignedUserId ?? "").trim();
  return assignee.length > 0 ? assignee : null;
}

/**
 * May this step be closed? Only step 5 is asked, and only about the one fact it
 * exists to produce. Every other step answers `null` — this adds no gate
 * anywhere else in the process.
 */
export function declarantRequiredRefusal(
  stepKey: string,
  executions: readonly StepAssignmentView[],
): "declarant_required" | null {
  if (stepKey !== DECLARANT_ASSIGNMENT_STEP) return null;
  return declarantOf(executions) === null ? "declarant_required" : null;
}

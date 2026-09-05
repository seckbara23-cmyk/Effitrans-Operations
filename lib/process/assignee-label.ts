/**
 * Who holds a claimed step — the display label, and only the label. PURE.
 * ---------------------------------------------------------------------------
 * Extracted from the process page so the three cases that matter can be driven
 * by tests instead of asserted as strings: a resolved name, the email fallback,
 * and a lookup that FAILED.
 *
 * It decides nothing. Authority is `activateStep` / `submitStep`; the claim
 * itself is `process_step_execution.assigned_user_id`; the UI narrowing is
 * `evaluateStepAction`. This file answers one question — what do we write next
 * to « En cours : » — and getting it wrong is what made a dossier tell an
 * Account Manager that somebody else held their own step.
 *
 * THE DISTINCTION THIS EXISTS TO KEEP. "No row for this id" and "the query
 * failed" are different facts. The first means the claimant is real and this
 * reader cannot name them. The second means we do not know anything, and
 * claiming « une autre personne » there asserts something we have not
 * established. The page had no way to tell them apart, because the failure was
 * swallowed and both arrived as an empty map.
 */

/** One `app_user` row, exactly as the page projects it. */
export type AssigneeRow = { id: string; name: string | null; email: string };

/**
 * id → display label. The name when there is one, the email otherwise.
 *
 * A blank or whitespace-only name is not a name: it would render as an empty
 * « En cours : » and read as a rendering bug rather than as a person.
 */
export function assigneeLabelMap(rows: readonly AssigneeRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const named = typeof r.name === "string" && r.name.trim().length > 0;
    out.set(r.id, named ? (r.name as string).trim() : r.email);
  }
  return out;
}

/** What the page renders as the claimant, or null when nothing is claimed. */
export function resolveAssigneeLabel(input: {
  assignedUserId: string | null;
  names: ReadonlyMap<string, string>;
  /** The claimant query itself failed — distinct from "returned no row". */
  lookupFailed: boolean;
}): string | null {
  if (!input.assignedUserId) return null;
  const known = input.names.get(input.assignedUserId);
  if (known) return known;
  // Unresolved, said two different ways on purpose.
  return input.lookupFailed ? "nom indisponible" : "une autre personne";
}

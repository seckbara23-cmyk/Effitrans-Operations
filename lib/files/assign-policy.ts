/**
 * Dossier assignment policy (Phase 3.2A). PURE — no I/O, unit-testable.
 * ---------------------------------------------------------------------------
 * A dossier may only be assigned to an ACTIVE staff member in the SAME tenant.
 * The server action (lib/files/actions.ts#assignFile) looks the candidate up
 * with the admin client and feeds the result here; this module decides so the
 * rules (reject unknown / inactive / cross-tenant) are testable without a DB.
 */
export type AssigneeCandidate = {
  /** the candidate row was found at all (by id) */
  found: boolean;
  /** app_user.status === 'active' */
  active: boolean;
  /** candidate.tenant_id === actor.tenant_id */
  sameTenant: boolean;
};

export type AssignDecision =
  | { ok: true }
  | { ok: false; error: "invalid_assignee" };

/**
 * Validate a proposed assignee. Unknown, inactive or cross-tenant candidates are
 * all rejected as a single "invalid_assignee" (the UI never surfaces which — it
 * only offers valid staff, so a rejection means a stale/forged id).
 */
export function validateAssignee(c: AssigneeCandidate): AssignDecision {
  if (!c.found || !c.active || !c.sameTenant) {
    return { ok: false, error: "invalid_assignee" };
  }
  return { ok: true };
}

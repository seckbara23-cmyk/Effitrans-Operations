/**
 * Seat eligibility (Phase WES-3J) — PURE, no I/O.
 * ---------------------------------------------------------------------------
 * Split out of `eligibility.ts` on purpose: that module resolves the policy and
 * is therefore server-only, while the DECISION it feeds is a pure predicate.
 * Keeping the predicate here means the fail-closed behaviour is testable
 * without a database or a React request scope.
 */

export type EligibilityResult = {
  /** Role codes permitted to hold this seat. Empty ⇒ nobody. */
  roles: string[];
  /** The pinned version the decision was made under, recorded on history. */
  policyVersionId: string | null;
  /** True when the seat is satisfied by identity, not by role. */
  identityBound: boolean;
  /** False when policy could not be resolved — the caller must refuse. */
  resolved: boolean;
};

export const NOT_RESOLVED: EligibilityResult = {
  roles: [],
  policyVersionId: null,
  identityBound: false,
  resolved: false,
};

/**
 * Is `roleCodes` eligible for the seat?
 *
 * Fail-closed on every axis, each for its own reason:
 *   unresolved policy — we do not know the rule, so we do not permit;
 *   empty binding     — policy has not said who may hold this seat, and
 *                       inventing an answer is how hardcoded role lists return;
 *   identity-bound    — the seat belongs to a specific person by definition
 *                       (e.g. "the request's own author") and is not assignable;
 *   no overlap        — the ordinary negative.
 */
export function isEligibleForSeat(
  eligibility: EligibilityResult,
  roleCodes: readonly string[],
): boolean {
  if (!eligibility.resolved) return false;
  if (eligibility.identityBound) return false;
  if (eligibility.roles.length === 0) return false;
  return roleCodes.some((r) => eligibility.roles.includes(r));
}

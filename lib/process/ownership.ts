/**
 * Canonical process ownership (Phase 9.0B) — PURE resolver. No I/O.
 * ---------------------------------------------------------------------------
 * Business rule: every dossier process has ONE operational owner (Operations),
 * responsible for overall coordination and operational closure. Ownership is
 * DISTINCT from task assignment — the owner does not become the assignee of
 * every step.
 *
 * The dossier historically carries three competing ownership columns
 * (account_manager_id — auto-set to the creator and never changed;
 * coordinator_id; assigned_to_user_id) — the 9.0A audit's "three-headed
 * ownership" finding. None is removed or repurposed. Phase 9.0B adds the
 * canonical `process_instance.owner_user_id`, and THIS resolver defines the
 * one documented precedence every reader uses during the migration window:
 *
 *   1. canonical process owner        (process_instance.owner_user_id)
 *   2. coordinator_id                 (when it names a currently-valid user)
 *   3. account_manager_id             (when it names a currently-valid user)
 *   4. dossier creator                (READ-ONLY last fallback — display only)
 *
 * Fallback-derived values are NEVER written back automatically (no silent
 * backfill — docs/workflow/phase-9.0b-migration-and-rollout.md).
 */

export type OwnershipCandidates = {
  /** process_instance.owner_user_id — the canonical owner, when assigned. */
  ownerUserId?: string | null;
  /** operational_file.coordinator_id */
  coordinatorId?: string | null;
  /** operational_file.account_manager_id */
  accountManagerId?: string | null;
  /** operational_file.created_by */
  createdBy?: string | null;
};

export type EffectiveOwnerSource = "canonical" | "coordinator" | "account_manager" | "creator" | "none";

export type EffectiveOwner = {
  userId: string | null;
  source: EffectiveOwnerSource;
};

/**
 * The effective operational owner for display/routing during the migration
 * window. `validUserIds`, when provided, filters legacy candidates to
 * currently-valid (active, same-tenant) users — a departed coordinator never
 * resolves as owner. The CANONICAL owner is not filtered here: the assignment
 * action already validated it, and hiding it silently would misreport who is
 * accountable (a stale canonical owner is surfaced, then corrected by a new
 * audited assignment).
 */
export function resolveEffectiveProcessOwner(
  candidates: OwnershipCandidates,
  validUserIds?: ReadonlySet<string>,
): EffectiveOwner {
  const valid = (id: string | null | undefined): id is string =>
    !!id && (!validUserIds || validUserIds.has(id));

  if (candidates.ownerUserId) return { userId: candidates.ownerUserId, source: "canonical" };
  if (valid(candidates.coordinatorId)) return { userId: candidates.coordinatorId, source: "coordinator" };
  if (valid(candidates.accountManagerId)) return { userId: candidates.accountManagerId, source: "account_manager" };
  if (valid(candidates.createdBy)) return { userId: candidates.createdBy, source: "creator" };
  return { userId: null, source: "none" };
}

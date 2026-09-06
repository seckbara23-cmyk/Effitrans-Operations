/**
 * Control ownership (OPS-CUSTOMS-OWNERSHIP-01) — PURE decision core.
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES. The 2026-08-24 step gate asks two questions: is the
 * owning step open, and is it claimed by somebody else. It never asks whether
 * the work is YOURS. So an official step that is open and UNASSIGNED is
 * exercisable by anyone holding the permission — and the customs permissions are
 * deliberately broad, because a Chef de Transit legitimately holds
 * `customs:update` for their own acts. During UAT that produced exactly the
 * confusion it sounds like: the Dédouanement panel offered a Chef de Transit the
 * Déclarant's maker controls, and the only thing standing between them was that
 * the Déclarant happened to have claimed the step first.
 *
 * The step registry already names the owner of every step, and the database
 * already carries it in `process_step_owning_role`. Nothing consulted it.
 *
 * WHAT THIS ADDS, AND ONLY THIS. On an open step with NO assignee, the actor
 * must hold that step's owning role. Everything else defers:
 *
 *   * no process instance      -> defer (the same compatibility path the step
 *                                 gate documents; not a second policy)
 *   * step has no owning role  -> defer to permission, exactly as an unmapped
 *                                 control already does
 *   * assigned to the actor    -> ALLOW. An explicit, audited assignment is a
 *                                 stronger statement than role membership, and
 *                                 a Chef who was assigned the work owns it
 *   * assigned to someone else -> defer. `assertControlStep` already refuses
 *                                 this; refusing twice would give one situation
 *                                 two different sentences
 *
 * NO IMPLICIT BYPASS, INCLUDING PLATFORM ADMINISTRATION. Ratified 2026-09-06:
 * SYSTEM_ADMIN is not an owner of any step and is refused here like anyone
 * else. The escape hatch is the audited one that already exists — assign the
 * step, then act — which leaves a record of who took someone's work and when.
 * That is the 2026-08-24 rule restated: coverage for absence is an explicit
 * audited override, never implicit permission inheritance.
 *
 * PURE and client-safe: no I/O, no server imports. The panel renders the same
 * verdict the server enforces, so the two cannot disagree.
 */

export type ControlOwnershipInput = {
  /** false when the dossier has no process instance at all. */
  hasInstance: boolean;
  /** `process_step_owning_role.role_code` for the owning step, or null. */
  owningRole: string | null;
  /** Tenant role codes held by the actor. */
  actorRoles: readonly string[];
  /** `process_step_execution.assigned_user_id`, or null when unclaimed. */
  stepAssignedUserId: string | null;
  userId: string;
};

export type ControlOwnershipResult =
  | {
      allowed: true;
      reason: "no_instance" | "unowned_step" | "assigned_to_self" | "assigned_to_other" | "owning_role";
    }
  | { allowed: false; reason: "not_owning_role" };

/**
 * May this actor exercise a control whose step is open? PURE.
 *
 * Order is load-bearing and each branch is a deliberate deferral rather than an
 * oversight — see the header for why each one defers.
 */
export function evaluateControlOwnership(input: ControlOwnershipInput): ControlOwnershipResult {
  if (!input.hasInstance) return { allowed: true, reason: "no_instance" };
  if (!input.owningRole) return { allowed: true, reason: "unowned_step" };
  if (input.stepAssignedUserId !== null) {
    return input.stepAssignedUserId === input.userId
      ? { allowed: true, reason: "assigned_to_self" }
      : // Not ours to refuse: the step gate already says `assigned_to_another`.
        { allowed: true, reason: "assigned_to_other" };
  }
  return input.actorRoles.includes(input.owningRole)
    ? { allowed: true, reason: "owning_role" }
    : { allowed: false, reason: "not_owning_role" };
}

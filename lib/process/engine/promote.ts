import "server-only";
/**
 * Successor promotion — SERVER-ONLY, deliberately NOT a "use server" module.
 * ---------------------------------------------------------------------------
 * It lives apart from `actions.ts` so it can be shared by the completion sites
 * (submit, approve, skip) WITHOUT becoming a client-callable server action: it
 * takes a tenantId directly, and a server action exposing that shape would let a
 * caller name someone else's tenant. Same reason `stepPermission` sits in the
 * pure state module.
 *
 * THE DEFECT THIS CLOSES (D-1). `PENDING -> ACTIVE` is not a legal transition,
 * and the engine had exactly TWO writers of AVAILABLE: `activateEntryStep`
 * (entry steps) and `receiveHandoff` (handoff targets). Nothing promoted a
 * completed step's `nextSteps`, so every step that is neither — step 3
 * `am_dossier_opening` first among them — could never leave PENDING by any
 * legitimate path, and was invisible in every queue.
 *
 * ATTRIBUTION (F-α, first production incident). The first execution of this
 * function crashed the operator's request AFTER every write had committed,
 * because the promotion audit was written with `actorId: null` and the audit
 * layer rightly refuses unattributed non-system actions (fail closed —
 * RATIFY-OPSSEC2-2A: a NULL actor carries no authority). The promotion has a
 * real principal: THE ACTOR WHOSE COMPLETION CAUSED IT. Every caller passes that
 * identity, and no system principal is invented.
 *
 * AUDIT FAILURE HANDLING (F-β). The audit for a promotion is mandatory. If it
 * fails, the promotion is COMPENSATED with a strict CAS that only succeeds while
 * the successor is still EXACTLY as this promotion left it — AVAILABLE,
 * unassigned, unstarted. An execution someone has already claimed or started is
 * never reverted.
 *
 *   DOCUMENTED HARD-ERROR CONDITION: if the audit failed AND the compensation
 *   CAS cannot safely apply (the row has been claimed/started in the interim),
 *   an unaudited promotion survives that we refuse to overwrite. That is an
 *   audit-integrity breach and it is surfaced as a HARD error
 *   (`promotion_audit_unrecoverable`) rather than swallowed — the parent
 *   completion is already committed and stays committed; what fails loudly is
 *   the request, so the gap is seen the moment it exists instead of discovered
 *   in an audit years later.
 *
 * ATOMICITY FOLLOW-UP. A single transaction/RPC doing (promotion + audit)
 * atomically would remove the compensation path entirely. That needs a
 * migration; recorded as follow-up hardening rather than smuggled into this
 * change.
 *
 * WHAT PROMOTION DELIBERATELY DOES NOT DO:
 *   • never promotes to ACTIVE (a human still starts the work; PENDING ->
 *     ACTIVE is illegal anyway);
 *   • never touches a successor that is not PENDING — idempotent, never
 *     overwrites AVAILABLE/ACTIVE/terminal states;
 *   • never bypasses `prerequisitesMet` — a successor waiting on a parallel
 *     branch stays PENDING until the LAST prerequisite lands;
 *   • grants no permission and moves no assignment.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { dependentsOf, prerequisitesMet } from "./state";
import { loadProcessSnapshot, toViews } from "./snapshot";

export class PromotionAuditUnrecoverableError extends Error {
  constructor(stepKey: string, cause: unknown) {
    super(
      `promotion_audit_unrecoverable: step "${stepKey}" was promoted, its audit failed, ` +
        `and the promotion can no longer be safely reverted (the step has been claimed or started). ` +
        `Original audit failure: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "PromotionAuditUnrecoverableError";
  }
}

export async function promoteSuccessors(
  tenantId: string,
  fileId: string,
  permissions: string[],
  completedStepKey: string,
  /**
   * F-α: the actor whose completion caused these promotions.
   *
   * NULL is permitted for one case only — a genuinely system-caused
   * reconciliation with no authenticated principal — and it is NOT written as an
   * unattributed `process.step.activated`. It emits the `system.`-prefixed
   * action instead, which the audit layer accepts as machine-caused. No
   * principal is invented, and the two kinds stay distinguishable in the ledger.
   */
  actorId: string | null,
): Promise<void> {
  // C-1 — DEPENDENTS, not `nextSteps`. A step becomes reachable exactly when the
  // thing it declares it waits for is done, so promotion and `prerequisitesMet`
  // read the same relation and cannot disagree. Promoting from `nextSteps` left
  // step 14 (`transport_assignment`, prerequisite step 3, named by nobody)
  // permanently PENDING, which made the pickup convergence — and steps 15-26 —
  // unreachable.
  const successors = dependentsOf(completedStepKey);
  if (successors.length === 0) return;

  const snap = await loadProcessSnapshot(tenantId, fileId, permissions);
  if (!snap?.instance) return;
  const views = toViews(snap.executions);
  const admin = getAdminSupabaseClient();

  for (const key of successors) {
    const exec = snap.executions.find((e) => e.stepKey === key);
    if (!exec || exec.state !== "PENDING") continue;      // idempotent; never overwrites
    if (!prerequisitesMet(key, views)) continue;          // parallel branches converge here

    // CAS on PENDING: a concurrent promoter that already moved this row makes
    // the update match zero rows, so the promotion happens exactly once.
    const { data, error } = await admin
      .from("process_step_execution")
      .update({ state: "AVAILABLE" })
      .eq("id", exec.id)
      .eq("tenant_id", tenantId)
      .eq("state", "PENDING")
      .select("id");
    if (error || (data?.length ?? 0) !== 1) continue;      // a concurrent promoter won

    try {
      await writeAudit({
        action: actorId
          ? AuditActions.PROCESS_STEP_ACTIVATED
          : AuditActions.PROCESS_STEP_ACTIVATED_SYSTEM,
        actorId: actorId ?? undefined,
        tenantId,
        entity: "process_step_execution",
        entityId: exec.id,
        after: { step_key: key, state: "AVAILABLE", promoted_from: completedStepKey },
      });
    } catch (auditFailure) {
      // F-β: no unaudited promotion may survive. Strict compensation — only if
      // the row is still EXACTLY as this promotion left it: AVAILABLE,
      // unassigned, unstarted. AVAILABLE -> PENDING is a legal transition.
      const { data: reverted, error: revertError } = await admin
        .from("process_step_execution")
        .update({ state: "PENDING" })
        .eq("id", exec.id)
        .eq("tenant_id", tenantId)
        .eq("state", "AVAILABLE")
        .is("assigned_user_id", null)
        .is("started_at", null)
        .select("id");
      if (revertError || (reverted?.length ?? 0) !== 1) {
        // The documented hard-error condition: claimed/started in the interim.
        // Never overwrite later work — fail loudly instead.
        throw new PromotionAuditUnrecoverableError(key, auditFailure);
      }
      // Compensated: the successor is PENDING again and the next completion (or
      // a retry) will re-promote it idempotently. The parent completion that
      // triggered us is a committed fact and is not disturbed.
    }
  }
}

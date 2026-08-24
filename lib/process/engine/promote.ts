import "server-only";
/**
 * Successor promotion — SERVER-ONLY, deliberately NOT a "use server" module.
 * ---------------------------------------------------------------------------
 * It lives apart from `actions.ts` so it can be shared by the completion sites
 * (submit, approve, skip) WITHOUT becoming a client-callable server action: it
 * takes a tenantId directly, and a server action exposing that shape would let a
 * caller name someone else's tenant. Same reason `stepPermission` sits in the
 * pure state module.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { getNode, prerequisitesMet } from "./state";
import { loadProcessSnapshot, toViews } from "./snapshot";

/**
 * SUCCESSOR PROMOTION (D-1, ratified 2026-08-24).
 *
 * THE DEFECT THIS CLOSES. `PENDING -> ACTIVE` is not a legal transition, and the
 * engine had exactly TWO writers of AVAILABLE: `activateEntryStep` (entry steps)
 * and `receiveHandoff` (handoff targets). Nothing promoted a completed step's
 * `nextSteps`. So every step that is neither an entry step nor a handoff target
 * — step 3 `am_dossier_opening` first among them — could never leave PENDING by
 * any legitimate path, and because the queues list OPEN_STATES (plus open-handoff
 * targets) it was invisible everywhere too. On EFT-IMP-2026-00008 that produced a
 * deadlock: Transit correctly refused for want of step 3, and the Account Manager
 * had no step 3 to perform.
 *
 * THE RULE. When a step reaches a terminal-done state, each of its declared
 * successors is promoted PENDING -> AVAILABLE — the already-legal transition —
 * and ONLY when `prerequisitesMet` holds for that successor.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   • never promotes to ACTIVE (a human still starts the work, and PENDING ->
 *     ACTIVE is illegal anyway);
 *   • never touches a successor that is not PENDING, so AVAILABLE, ACTIVE,
 *     SUBMITTED and every terminal state are left exactly as they are — which is
 *     also what makes it idempotent;
 *   • never bypasses `prerequisitesMet`, so a successor waiting on a parallel
 *     branch stays PENDING until the LAST prerequisite lands, and whichever
 *     branch finishes last performs the single promotion;
 *   • grants no permission and moves no assignment: the successor becomes
 *     available to its owning role, unassigned, exactly as the queues expect.
 *
 * Best-effort by contract: promotion failures never fail the completion that
 * triggered them — the step that just completed is a fact, and a promotion is a
 * consequence that the next completion (or reception) can still perform.
 */
export async function promoteSuccessors(
  tenantId: string,
  fileId: string,
  permissions: string[],
  completedStepKey: string,
): Promise<void> {
  const successors = getNode(completedStepKey)?.nextSteps ?? [];
  if (successors.length === 0) return;

  const snap = await loadProcessSnapshot(tenantId, fileId, permissions);
  if (!snap?.instance) return;
  const views = toViews(snap.executions);

  for (const key of successors) {
    const exec = snap.executions.find((e) => e.stepKey === key);
    if (!exec || exec.state !== "PENDING") continue;      // idempotent; never overwrites
    if (!prerequisitesMet(key, views)) continue;          // parallel branches converge here
    // CAS on PENDING: a concurrent promoter that already moved this row makes
    // the update match zero rows, so the promotion happens exactly once.
    const { data, error } = await getAdminSupabaseClient()
      .from("process_step_execution")
      .update({ state: "AVAILABLE" })
      .eq("id", exec.id)
      .eq("tenant_id", tenantId)
      .eq("state", "PENDING")
      .select("id");
    if (error || (data?.length ?? 0) !== 1) continue;      // a concurrent promoter won
    await writeAudit({
      action: AuditActions.PROCESS_STEP_ACTIVATED,
      actorId: null,
      tenantId,
      entity: "process_step_execution",
      entityId: exec.id,
      after: { step_key: key, state: "AVAILABLE", promoted_from: completedStepKey },
    });
  }
}


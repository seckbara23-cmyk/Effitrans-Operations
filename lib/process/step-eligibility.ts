/**
 * THE one answer to "may this person act on this step, right now?" — PURE.
 * ---------------------------------------------------------------------------
 * Two surfaces execute official steps: the department queue
 * (`/queues/[queueKey]`) and the dossier's official-process page
 * (`/files/[id]/process`). Both call the SAME server actions, and both must
 * therefore offer the same buttons on the same facts.
 *
 * This module exists because the alternative was tried. UAT-OPS-TRANSIT-00009
 * found two surfaces holding different opinions about one server rule: the
 * dossier page could name why a transmission was blocked while the process
 * screen offered an enabled button and then reported « L'action a échoué ».
 * The fix there was one evaluator for one decision; this is the same fix for
 * step execution, applied before the second surface exists rather than after.
 *
 * WHAT THIS IS, AND IS NOT. It decides what a surface OFFERS. It is not a
 * boundary: `activateStep` and `submitStep` re-check permission, prerequisites,
 * reception and state on every call, and they are what actually refuse. A UI
 * that hides a button is a courtesy; a server that refuses is the control. The
 * rule for changing this file is therefore narrow — it may become no more
 * permissive than the engine, and where it is stricter (see CLAIM below) that
 * strictness must be a deliberate, recorded product decision.
 */
import { stepPermission } from "./engine/state";
// The PURE check module, not the server-side permissions facade: this file
// is read by client components and must not drag a React cache() into them.
import { hasPermission } from "@/lib/rbac/check";

/** Everything the decision needs. Each field is a FACT, never a rendered flag. */
export type StepActionFacts = {
  stepKey: string;
  /** process_step_execution.state */
  state: string;
  /** process_step_execution.assigned_user_id */
  assignedUserId: string | null;
  /**
   * True when a handoff addressed to THIS step is still SENT. The engine
   * refuses `handoff_reception_required` at both activate and submit until the
   * receiving department accepts it, so no surface may offer work before then.
   */
  awaitingReception: boolean;
  /** An open blocker that should stop execution, already resolved by the caller. */
  blockedReason?: string | null;
};

export type StepActionViewer = {
  userId: string;
  permissions: readonly string[];
};

export type StepEligibility = {
  /** The step's own permission — `permissions[0]`, exactly as the engine reads it. */
  permission: string;
  /** Does the viewer hold it? The engine's `guard()` asks precisely this. */
  mayAct: boolean;
  /** ACTIVE and claimed by somebody else. */
  claimedByAnother: boolean;
  awaitingReception: boolean;
  /** AVAILABLE → ACTIVE. Claims the step for the viewer. */
  canStart: boolean;
  /** ACTIVE → SUBMITTED/COMPLETED. */
  canSubmit: boolean;
  /**
   * Why nothing is offered, in the operator's language. Never null when both
   * actions are unavailable and the step is otherwise open — an empty row that
   * explains itself beats a silent one.
   */
  reasonFr: string | null;
};

/** States in which a surface may reasonably talk about executing a step. */
const OFFERABLE = new Set(["AVAILABLE", "ACTIVE"]);

export function evaluateStepAction(
  facts: StepActionFacts,
  viewer: StepActionViewer,
): StepEligibility {
  const permission = stepPermission(facts.stepKey);
  const mayAct = hasPermission([...viewer.permissions], permission);

  // CLAIM. `activateStep` writes `assigned_user_id = caller`, so an ACTIVE step
  // belongs to whoever started it. The engine does NOT currently refuse a
  // same-permission colleague who submits it, so this is a deliberate UI
  // narrowing, ratified 2026-09-04: an official step is somebody's work, and a
  // supervisor must not complete an Account Manager's attestation for them by
  // pressing a button on a page they can both see. Recorded as narrowing rather
  // than as a guard, because it is not one.
  const claimedByAnother =
    facts.state === "ACTIVE" &&
    facts.assignedUserId !== null &&
    facts.assignedUserId !== viewer.userId;

  const blocked = Boolean(facts.blockedReason);
  const canStart =
    mayAct && facts.state === "AVAILABLE" && !facts.awaitingReception && !blocked;
  const canSubmit =
    mayAct && facts.state === "ACTIVE" && !claimedByAnother && !facts.awaitingReception && !blocked;

  return {
    permission,
    mayAct,
    claimedByAnother,
    awaitingReception: facts.awaitingReception,
    canStart,
    canSubmit,
    reasonFr: reasonFor({ facts, mayAct, claimedByAnother, blocked, canStart, canSubmit }),
  };
}

function reasonFor(input: {
  facts: StepActionFacts;
  mayAct: boolean;
  claimedByAnother: boolean;
  blocked: boolean;
  canStart: boolean;
  canSubmit: boolean;
}): string | null {
  const { facts, mayAct, claimedByAnother, blocked, canStart, canSubmit } = input;
  if (canStart || canSubmit) return null;
  if (!OFFERABLE.has(facts.state)) return null; // nothing to explain yet
  if (facts.awaitingReception) return "Le transfert doit d'abord être réceptionné.";
  if (blocked) return facts.blockedReason ?? "Un point bloquant est ouvert sur ce dossier.";
  if (!mayAct) return "Cette étape relève d'un autre rôle.";
  if (claimedByAnother) return "Étape déjà prise en charge par une autre personne.";
  return null;
}

/**
 * Control ownership — SERVER side. Loads the facts, applies the pure rule.
 * ---------------------------------------------------------------------------
 * The enforcement half of OPS-CUSTOMS-OWNERSHIP-01, deliberately a SIBLING of
 * `assertControlStep` rather than an edit to it. That function carries a
 * ratification of its own (2026-08-24) and a large blast radius across customs,
 * finance and evidence; this adds one narrower condition without reopening it.
 *
 * TWO ENTRY POINTS, ONE RULE:
 *   * `assertControlOwner` — enforcement, called by each action after the step
 *     gate has already allowed;
 *   * `getControlVerdicts` — the same rule, batched, for the UI. The panel
 *     renders what the server would decide instead of re-deriving it, which is
 *     how a page ends up offering a button the server refuses.
 *
 * ⚠ `getControlVerdicts` ALSO EVALUATES THE STEP GATE (UAT-BLOCKER-STEP67-PROD-02).
 * That is the whole point of it — the panel must show what the action would
 * decide — but it makes this the SECOND caller of `evaluateControlGate`, and
 * the one the browser actually sees. `assertControlStep` refuses a click;
 * this decides whether there is a click to refuse. A fix applied to the
 * enforcement gate alone therefore changes nothing an operator can reach:
 * UAT-WF-STEP67-01 taught the enforcement gate that a SUBMITTED maker opens
 * its checker's control, and the Chef de Transit's button stayed disabled on
 * EFT-IMP-2026-00011 because this function was still refusing it
 * `step_not_open`. ANY future change to the gate's fact set must be made in
 * BOTH places, and the parity is pinned by a test.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import type { StepState } from "./engine/types";
import {
  CONTROL_OWNING_STEP,
  CONTROL_OWNERSHIP_ERROR,
  controlGateError,
  evaluateControlGate,
  stepGateMessageFr,
} from "./control-gate";
import { evaluateControlOwnership } from "./control-ownership";
import { preparerStepFor } from "./engine/state";
// ONE reader of `process_step_owning_role` for the whole platform.
import { owningRoleByStepKey as owningRoles } from "./contextual/owning-roles";

type Row = Record<string, unknown>;

/**
 * The owning role of ONE step, or null when the registry mirror names none.
 *
 * Exported for the engine (OPS-CUSTOMS-GAINDE-04 A4). `activateStep` needs the
 * same fact this module already loads, and the alternative — a second query
 * written next to the engine — is how two answers to one question start.
 */
export async function stepOwningRole(stepKey: string): Promise<string | null> {
  return (await owningRoles([stepKey])).get(stepKey) ?? null;
}

/**
 * Assert that `controlId`'s work belongs to this actor right now.
 *
 * Returns null when allowed, or `step_gate_not_owning_role`. Call AFTER
 * `assertControlStep`: this answers "is it yours", never "is it open".
 */
export async function assertControlOwner(
  controlId: string,
  fileId: string,
  tenantId: string,
  userId: string,
  roles: readonly string[],
): Promise<string | null> {
  const stepKey = CONTROL_OWNING_STEP[controlId];
  if (!stepKey) return null; // permission-governed control; unchanged

  const admin = getAdminSupabaseClient();
  const { data: instRows } = await scopedFrom(admin, "process_instance", tenantId)
    .select("id")
    .eq("file_id", fileId)
    .limit(1);
  const instance = ((instRows ?? []) as Row[])[0];
  if (!instance) return null; // compatibility path, identical to the step gate

  const [{ data: execRows }, ownerByStep] = await Promise.all([
    scopedFrom(admin, "process_step_execution", tenantId)
      .select("assigned_user_id")
      .eq("process_instance_id", instance.id as string)
      .eq("step_key", stepKey)
      .limit(1),
    owningRoles([stepKey]),
  ]);
  const exec = ((execRows ?? []) as Row[])[0];

  const verdict = evaluateControlOwnership({
    hasInstance: true,
    owningRole: ownerByStep.get(stepKey) ?? null,
    actorRoles: roles,
    stepAssignedUserId: exec ? ((exec.assigned_user_id as string) ?? null) : null,
    userId,
  });
  return verdict.allowed ? null : CONTROL_OWNERSHIP_ERROR;
}

export type ControlVerdict = {
  /** The server would permit this control right now. */
  allowed: boolean;
  /** `step_gate_*` when refused, else null. */
  reasonCode: string | null;
  /** The operator-facing sentence for a refusal, else null. */
  reasonFr: string | null;
  /**
   * This control's work belongs to this actor — by owning role, or because the
   * step is assigned to them. Drives whether a control is drawn at all: a
   * control that will never be this person's is noise, not information.
   */
  isOwner: boolean;
};

/**
 * The verdict for several controls on one dossier, in ONE pass.
 *
 * Composes BOTH rules — the 2026-08-24 step gate and the ownership rule — so a
 * surface reading this cannot drift from what the actions enforce.
 */
export async function getControlVerdicts(
  controlIds: readonly string[],
  fileId: string,
  tenantId: string,
  userId: string,
  roles: readonly string[],
): Promise<Record<string, ControlVerdict>> {
  const ALLOW: ControlVerdict = { allowed: true, reasonCode: null, reasonFr: null, isOwner: true };
  const out: Record<string, ControlVerdict> = {};

  const owningSteps = controlIds
    .map((c) => CONTROL_OWNING_STEP[c])
    .filter((k): k is string => !!k);
  // UAT-BLOCKER-STEP67-PROD-02 — a maker-checker VALIDATOR control is decided
  // by its PREPARER's state, so the preparer's row has to be in the batch.
  // Today the dossier page happens to ask for `customs.update` too, which owns
  // step 6 and would have pulled it in by luck; a caller asking only for
  // `customs.validation` would not, and luck is not a fact set.
  const stepKeys = [
    ...new Set([
      ...owningSteps,
      ...owningSteps.map((k) => preparerStepFor(k)).filter((k): k is string => !!k),
    ]),
  ];
  // Controls with no owning step are permission-governed; say so once here.
  for (const id of controlIds) if (!CONTROL_OWNING_STEP[id]) out[id] = ALLOW;
  if (stepKeys.length === 0) return out;

  const admin = getAdminSupabaseClient();
  const { data: instRows } = await scopedFrom(admin, "process_instance", tenantId)
    .select("id")
    .eq("file_id", fileId)
    .limit(1);
  const instance = ((instRows ?? []) as Row[])[0];
  if (!instance) {
    for (const id of controlIds) out[id] = ALLOW; // compatibility path
    return out;
  }

  const [{ data: execRows }, ownerByStep] = await Promise.all([
    scopedFrom(admin, "process_step_execution", tenantId)
      .select("step_key, state, assigned_user_id")
      .eq("process_instance_id", instance.id as string)
      .in("step_key", stepKeys),
    owningRoles(stepKeys),
  ]);
  // THE LIVE ATTEMPT, the way `loadStep` and `assertControlStep` define it.
  // `rejectStep` freezes the rejected row and creates a NEW attempt, so a
  // corrected step has two rows and a last-wins map would render the verdict
  // for whichever the database returned second.
  const execByStep = new Map<string, Row>();
  for (const r of (execRows ?? []) as Row[]) {
    const key = r.step_key as string;
    const dead = r.state === "REJECTED" || r.state === "CANCELLED";
    const held = execByStep.get(key);
    if (!held || (dead === false && (held.state === "REJECTED" || held.state === "CANCELLED"))) {
      execByStep.set(key, r);
    }
  }

  for (const id of controlIds) {
    const stepKey = CONTROL_OWNING_STEP[id];
    if (!stepKey) continue; // already answered above
    const exec = execByStep.get(stepKey);
    const assigned = exec ? ((exec.assigned_user_id as string) ?? null) : null;
    const owningRole = ownerByStep.get(stepKey) ?? null;

    const step = exec
      ? { state: exec.state as StepState, assignedUserId: assigned }
      : null;
    // The SAME fact set the enforcement gate reads. Without the preparer's
    // state a checker control is refused `step_not_open` for the whole life of
    // the review, because a validator step's own row is PENDING throughout it
    // by construction — see `preparerState` in control-gate.ts.
    const preparerKey = preparerStepFor(stepKey);
    const preparerState = preparerKey
      ? ((execByStep.get(preparerKey)?.state as StepState | undefined) ?? null)
      : null;
    const gate = evaluateControlGate({ hasInstance: true, step, userId, preparerState });
    const own = evaluateControlOwnership({
      hasInstance: true,
      owningRole,
      actorRoles: roles,
      stepAssignedUserId: assigned,
      userId,
    });

    // Ownership decides whether the control is DRAWN; the step gate decides
    // whether it is ENABLED. A future step of one's own is worth showing
    // disabled, with the reason — that is the state the UAT operator had no way
    // to understand.
    const isOwner = own.allowed && own.reason !== "assigned_to_other";
    const refusedCode = !gate.allowed
      ? controlGateError(gate.reason)
      : !own.allowed
        ? CONTROL_OWNERSHIP_ERROR
        : null;

    out[id] = {
      allowed: refusedCode === null,
      reasonCode: refusedCode,
      reasonFr: stepGateMessageFr(refusedCode),
      isOwner,
    };
  }
  return out;
}

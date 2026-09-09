/**
 * Step-aware control gating — SERVER side. Loads the facts, applies the pure rule.
 * ---------------------------------------------------------------------------
 * This is the enforcement boundary. UI gating is advisory; every dossier control
 * calls through here, so a forged request meets the same rule as a rendered
 * button. See `control-gate.ts` for the ratified rule and for why a dossier with
 * no process instance defers to its permission check.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import type { StepState } from "./engine/types";
import { preparerStepFor } from "./engine/state";
import {
  CONTROL_OWNING_STEP,
  controlGateError,
  evaluateControlGate,
  type ControlGateResult,
} from "./control-gate";

type Row = Record<string, unknown>;

/**
 * Assert that `controlId` may be exercised on `fileId` by `userId` right now.
 * Returns null when allowed, or an error code when the step forbids it.
 *
 * The permission check is NOT performed here — each action keeps its own, and
 * this is the second, independent condition the ratification requires.
 */
export async function assertControlStep(
  controlId: string,
  fileId: string,
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const stepKey = CONTROL_OWNING_STEP[controlId];
  // A control with no official owner (e.g. administrative deletion) is governed
  // by its permission alone — deliberately, not by omission.
  if (!stepKey) return null;

  const admin = getAdminSupabaseClient();
  const { data: instRows } = await scopedFrom(admin, "process_instance", tenantId)
    .select("id")
    .eq("file_id", fileId)
    .limit(1);
  const instance = ((instRows ?? []) as Row[])[0];
  if (!instance) {
    return gateToError(evaluateControlGate({ step: null, hasInstance: false, userId }));
  }

  // UAT-WF-STEP67-01 — when the owning step is the VALIDATOR half of a
  // maker-checker pair, the PREPARER's state is part of the gate's fact set:
  // the validator row is PENDING for the whole review by construction, so
  // reading it alone refused every checker control forever. See
  // `preparerState` in control-gate.ts. Loaded in the SAME query — one round
  // trip, and no `.eq().eq()` cartesian surprise.
  const preparerKey = preparerStepFor(stepKey);
  const wantedKeys = preparerKey ? [stepKey, preparerKey] : [stepKey];

  const { data: execRows } = await scopedFrom(admin, "process_step_execution", tenantId)
    .select("step_key, state, assigned_user_id")
    .eq("process_instance_id", instance.id as string)
    .in("step_key", wantedKeys);
  const rows = (execRows ?? []) as Row[];

  /**
   * The LIVE attempt for a step, the way `loadStep` defines it.
   *
   * A rejected review does not mutate its execution row: `rejectStep` freezes
   * it and creates a NEW attempt (`correction_of_id`). So a corrected step has
   * two rows, and the previous `.limit(1)` returned whichever the database
   * offered first — which could be the frozen REJECTED one, and would then
   * refuse the correction it is meant to allow with `step_closed`. The engine
   * has always skipped REJECTED and CANCELLED here; the gate now does too.
   */
  const live = (key: string) =>
    rows.find((r) => r.step_key === key && r.state !== "REJECTED" && r.state !== "CANCELLED") ??
    rows.find((r) => r.step_key === key);

  const exec = live(stepKey);
  const preparerState = preparerKey
    ? ((live(preparerKey)?.state ?? null) as StepState | null)
    : null;

  return gateToError(
    evaluateControlGate({
      hasInstance: true,
      step: exec
        ? { state: exec.state as StepState, assignedUserId: (exec.assigned_user_id as string) ?? null }
        : null,
      userId,
      preparerState,
    }),
  );
}

function gateToError(result: ControlGateResult): string | null {
  return result.allowed ? null : controlGateError(result.reason);
}

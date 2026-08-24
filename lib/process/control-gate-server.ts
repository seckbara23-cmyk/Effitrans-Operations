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

  const { data: execRows } = await scopedFrom(admin, "process_step_execution", tenantId)
    .select("state, assigned_user_id")
    .eq("process_instance_id", instance.id as string)
    .eq("step_key", stepKey)
    .limit(1);
  const exec = ((execRows ?? []) as Row[])[0];

  return gateToError(
    evaluateControlGate({
      hasInstance: true,
      step: exec
        ? { state: exec.state as StepState, assignedUserId: (exec.assigned_user_id as string) ?? null }
        : null,
      userId,
    }),
  );
}

function gateToError(result: ControlGateResult): string | null {
  return result.allowed ? null : controlGateError(result.reason);
}

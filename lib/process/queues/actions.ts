"use server";
/**
 * Queue actions (Phase 5.0C, Deliverable 10). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * These are THIN wrappers over the Phase 5.0B engine. They exist so a page never
 * mutates process state itself, and so a queue action can revalidate the queue it
 * came from. Every one of them delegates the decision to the engine, which
 * re-authenticates, re-checks the tenant, re-checks the permission, validates the
 * state machine, the prerequisites, the evidence and the gates, and audits.
 *
 * NO new business logic lives here. If a rule is missing, it belongs in the
 * engine, not in the queue layer.
 */
import { revalidatePath } from "next/cache";
import {
  activateStep,
  approveStep,
  receiveHandoff,
  rejectHandoff,
  rejectStep,
  sendHandoff,
  submitStep,
} from "../engine/actions";
import { isQueueKey } from "./registry";
import type { EngineResult } from "../engine/types";

function refresh(queueKey: string, fileId: string) {
  if (isQueueKey(queueKey)) revalidatePath(`/queues/${queueKey}`);
  revalidatePath("/my-work");
  revalidatePath(`/files/${fileId}/process`);
}

export async function queueReceiveHandoff(
  queueKey: string,
  fileId: string,
  handoffId: string,
): Promise<EngineResult> {
  const r = await receiveHandoff(fileId, handoffId);
  if (r.ok) refresh(queueKey, fileId);
  return r;
}

export async function queueRejectHandoff(
  queueKey: string,
  fileId: string,
  handoffId: string,
  reason: string,
): Promise<EngineResult> {
  const r = await rejectHandoff(fileId, handoffId, reason);
  if (r.ok) refresh(queueKey, fileId);
  return r;
}

export async function queueStartStep(
  queueKey: string,
  fileId: string,
  stepKey: string,
): Promise<EngineResult> {
  const r = await activateStep(fileId, stepKey);
  if (r.ok) refresh(queueKey, fileId);
  return r;
}

export async function queueSubmitStep(
  queueKey: string,
  fileId: string,
  stepKey: string,
): Promise<EngineResult> {
  const r = await submitStep(fileId, stepKey);
  if (r.ok) refresh(queueKey, fileId);
  return r;
}

/** The CHECKER approves. The engine refuses if the checker IS the maker. */
export async function queueApproveStep(
  queueKey: string,
  fileId: string,
  validatorStepKey: string,
): Promise<EngineResult> {
  const r = await approveStep(fileId, validatorStepKey);
  if (r.ok) refresh(queueKey, fileId);
  return r;
}

/** The CHECKER rejects. A reason is mandatory — the engine enforces it. */
export async function queueRejectStep(
  queueKey: string,
  fileId: string,
  validatorStepKey: string,
  reason: string,
): Promise<EngineResult> {
  const r = await rejectStep(fileId, validatorStepKey, reason);
  if (r.ok) refresh(queueKey, fileId);
  return r;
}

export async function queueSendHandoff(
  queueKey: string,
  fileId: string,
  fromStepKey: string,
  toStepKey: string,
): Promise<EngineResult> {
  const r = await sendHandoff(fileId, fromStepKey, toStepKey);
  if (r.ok) refresh(queueKey, fileId);
  return r;
}

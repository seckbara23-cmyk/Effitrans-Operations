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
import {
  approveInvoice,
  emailValidatedInvoice,
  prepareInvoiceDraft,
  rejectInvoice,
  submitInvoiceToFinance,
} from "../billing/actions";
import { isQueueKey } from "./registry";
import type { BillingResult } from "../billing/actions";
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

// ------------------------------------------------- billing (Phase 5.0D-2) ----
//
// The Billing and Finance-validation queues act on the INVOICE, so they call the
// billing workflow rather than the raw step actions. Those actions still drive the
// process engine internally (submitStep / approveStep / rejectStep), so the
// official steps 20-22 stay in sync and the maker-checker rule is enforced twice:
// once on the invoice identity, once on the process execution row.

export async function queuePrepareInvoice(fileId: string): Promise<BillingResult<{ id: string }>> {
  const r = await prepareInvoiceDraft(fileId);
  if (r.ok) refresh("billing", fileId);
  return r;
}

export async function queueSubmitInvoice(fileId: string, invoiceId: string): Promise<BillingResult> {
  const r = await submitInvoiceToFinance(invoiceId);
  if (r.ok) refresh("billing", fileId);
  return r;
}

/** The CHECKER approves. Refused if this user drafted the invoice. */
export async function queueApproveInvoice(fileId: string, invoiceId: string): Promise<BillingResult> {
  const r = await approveInvoice(invoiceId);
  if (r.ok) refresh("finance", fileId);
  return r;
}

/** The CHECKER rejects. A reason is mandatory. */
export async function queueRejectInvoice(
  fileId: string,
  invoiceId: string,
  reason: string,
): Promise<BillingResult> {
  const r = await rejectInvoice(invoiceId, reason);
  if (r.ok) refresh("finance", fileId);
  return r;
}

/** Only a VALIDATED invoice may be emailed. A failed send stays retryable. */
export async function queueEmailInvoice(
  fileId: string,
  invoiceId: string,
): Promise<BillingResult<{ id: string; status: string }>> {
  const r = await emailValidatedInvoice(invoiceId);
  if (r.ok) refresh("billing", fileId);
  return r;
}

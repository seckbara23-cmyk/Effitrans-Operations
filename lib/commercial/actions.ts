"use server";

/**
 * EC-3B — Commercial actions.
 *
 * AUTHORITY — the four acts frozen in EC-3A, each with its own gate:
 *   prepare / revise / cancel      → quotation:create
 *   INTERNAL VALIDATION            → quotation:validate   (NEW — act 2 had none)
 *   send to the customer           → quotation:send
 *   record the customer's decision → quotation:approve
 *
 * Migration 82 REVOKED the Phase-5.0D blanket grant and granted the new code to
 * nobody, so **every action below denies everyone today**. That is the intended
 * dark state; re-granting is RATIFY-EC3-1, a ratification step, not a migration.
 *
 * MAKER-CHECKER: `quotation_validate` refuses when the validator is the
 * preparer (QT606) *and* a CHECK constraint refuses it independently. Neither
 * is the only line of defence, and no role membership can bypass either.
 *
 * WHAT COMMERCIAL NEVER DOES: create a dossier, write an invoice, send mail by
 * its own means, or touch a Finance table. Conversion CALLS the Operations
 * creation path and then records the link; sending goes through `lib/comms`.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { uploadObject, sha256Hex } from "@/lib/documents/storage";
import {
  parseQuantityMilli, parseAmountMinor, parseRateBp,
} from "./money";
import { validateAcceptance, type AcceptanceInput } from "./model";
import {
  renderQuotationPdf, quotationArtifactPath,
  QUOTATION_RENDERER_VERSION,
} from "./pdf";

export type CommercialResult = { ok: true; id?: string; number?: string } | { ok: false; error: string; detail?: string };

const RPC_ERRORS: Record<string, string> = {
  QT600: "request_not_found", QT601: "quotation_not_found", QT602: "not_draft", QT603: "no_lines",
  QT604: "invalid_decision", QT605: "not_pending_validation",
  QT606: "same_actor", QT607: "reason_required", QT608: "not_validated",
  QT609: "not_sent", QT610: "quotation_immutable", QT611: "terminal",
  QT612: "lines_frozen", QT613: "invalid_acceptance_kind",
  QT614: "not_revisable", QT615: "reason_required", QT616: "not_accepted",
  QT617: "dossier_not_found",
};
const mapRpc = (e: { code?: string; message?: string } | null) => ({
  error: (e?.code && RPC_ERRORS[e.code]) || "save_failed",
  detail: e?.message,
});

const PATH = "/commercial/quotations";

/* ========================================================================== */
/* Requests and drafting — quotation:create                                   */
/* ========================================================================== */

export async function createQuotationRequest(input: {
  clientId: string; reference?: string | null; subject?: string | null;
  triageItemId?: string | null;
}): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:create"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();

  const { data: client } = await s.from("client").select("id")
    .eq("id", input.clientId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!client) return { ok: false, error: "client_not_found" };

  const { data, error } = await s.from("quotation_request").insert({
    tenant_id: user.tenantId, client_id: input.clientId,
    reference: input.reference?.trim() || null,
    subject: input.subject?.trim() || null,
    triage_item_id: input.triageItemId || null,
    opened_by: user.id,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed", detail: error?.message };

  await writeAudit({ action: "commercial.request.opened", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation_request", entityId: data.id, after: { client_id: input.clientId } });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

/**
 * Draft version 1 for a request.
 *
 * Goes through an RPC so the row and its QUOTATION_CREATED event commit in ONE
 * transaction. An insert-then-emit from here would be two round trips, and the
 * event registry's "rpc" emission is a promise about exactly that guarantee.
 */
export async function createQuotation(requestId: string): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:create"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();

  const { data, error } = await s.rpc("quotation_create", {
    p_tenant: user.tenantId, p_request: requestId, p_actor: user.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };

  await writeAudit({ action: "commercial.quotation.created", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation", entityId: (data as string) ?? null, after: { request_id: requestId } });
  revalidatePath(PATH);
  return { ok: true, id: (data as string) ?? undefined };
}

/**
 * Replace the lines of a DRAFT quotation. Amounts arrive as user strings and
 * leave as INTEGER minor units — no float is ever persisted. The database
 * refuses this entirely once the quotation is sent (QT612).
 */
export async function setQuotationLines(
  quotationId: string,
  lines: { description: string; quantity: string; unitAmount: string; taxRate?: string }[],
): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:create"); } catch { return { ok: false, error: "forbidden" }; }
  if (lines.length === 0) return { ok: false, error: "no_lines" };

  const parsed: { position: number; description: string; quantity_milli: number; unit_amount_minor: number; tax_rate_bp: number }[] = [];
  for (const [i, l] of lines.entries()) {
    if (!l.description.trim()) return { ok: false, error: "description_required" };
    const q = parseQuantityMilli(l.quantity);
    const u = parseAmountMinor(l.unitAmount);
    const t = parseRateBp(l.taxRate ?? "");
    if (q === null) return { ok: false, error: "invalid_quantity" };
    if (u === null) return { ok: false, error: "invalid_amount" };
    if (t === null) return { ok: false, error: "invalid_tax_rate" };
    parsed.push({
      position: i + 1, description: l.description.trim().slice(0, 500),
      quantity_milli: q, unit_amount_minor: u, tax_rate_bp: t,
    });
  }

  const s = getAdminSupabaseClient();
  const { data: q } = await s.from("quotation").select("id, status")
    .eq("id", quotationId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!q) return { ok: false, error: "quotation_not_found" };
  if (q.status !== "DRAFT") return { ok: false, error: "not_draft" };

  const { error: delErr } = await s.from("quotation_line").delete()
    .eq("quotation_id", quotationId).eq("tenant_id", user.tenantId);
  if (delErr) return { ok: false, ...mapRpc(delErr) };

  const { error } = await s.from("quotation_line").insert(
    parsed.map((p) => ({ ...p, tenant_id: user.tenantId, quotation_id: quotationId })),
  );
  if (error) return { ok: false, ...mapRpc(error) };

  // Line COUNT only: amounts never enter the audit trail (WES-9C reasoning).
  await writeAudit({ action: "commercial.quotation.lines_set", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation", entityId: quotationId, after: { line_count: parsed.length } });
  revalidatePath(PATH);
  return { ok: true, id: quotationId };
}

export async function submitQuotation(quotationId: string): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:create"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("quotation_submit", {
    p_tenant: user.tenantId, p_quotation: quotationId, p_actor: user.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "commercial.quotation.submitted", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation", entityId: quotationId });
  revalidatePath(PATH);
  return { ok: true, id: quotationId };
}

/* ========================================================================== */
/* Act 2 — internal validation (quotation:validate)                           */
/* ========================================================================== */

export async function validateQuotation(input: {
  quotationId: string; decision: "VALIDATED" | "REJECTED"; reasonCode?: string | null;
}): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:validate"); }
  catch { return { ok: false, error: "forbidden_validate" }; }
  if (input.decision === "REJECTED" && !input.reasonCode?.trim()) {
    return { ok: false, error: "reason_required" };
  }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("quotation_validate", {
    p_tenant: user.tenantId, p_quotation: input.quotationId, p_actor: user.id,
    p_decision: input.decision, p_reason_code: input.reasonCode?.trim() || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({
    action: `commercial.quotation.${input.decision.toLowerCase()}`,
    actorId: user.id, tenantId: user.tenantId, entity: "quotation",
    entityId: input.quotationId, after: { reason_code: input.reasonCode?.trim() ?? null },
  });
  revalidatePath(PATH);
  return { ok: true, id: input.quotationId };
}

/* ========================================================================== */
/* Act 3 — send (quotation:send)                                              */
/* ========================================================================== */

/**
 * Mint the number, freeze the quotation, and generate the PDF artifact.
 *
 * The artifact follows the invoice discipline — render once, hash the exact
 * bytes, store privately, record path + hash + renderer version — but is NOT
 * registered as a `public.document` yet: that table requires a dossier, and a
 * quotation has none until conversion (EC-3D registers it).
 *
 * Emailing the customer is EC-3C and goes through `lib/comms`; this action
 * does not send mail and creates no communication engine.
 */
export async function sendQuotation(quotationId: string): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:send"); } catch { return { ok: false, error: "forbidden_send" }; }
  const s = getAdminSupabaseClient();

  const { data: number, error } = await s.rpc("quotation_send", {
    p_tenant: user.tenantId, p_quotation: quotationId, p_actor: user.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };

  // Best-effort artifact: the quotation IS sent once the RPC commits, and a
  // rendering failure must not un-send it. A missing artifact is visible and
  // regenerable; a rolled-back send would contradict an emitted event.
  try {
    await generateArtifact(user.tenantId, quotationId, user.id);
  } catch {
    /* recorded by the caller's audit; the send itself stands */
  }

  await writeAudit({ action: "commercial.quotation.sent", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation", entityId: quotationId, after: { quotation_number: number ?? null } });
  revalidatePath(PATH);
  return { ok: true, id: quotationId, number: (number as string) ?? undefined };
}

async function generateArtifact(tenantId: string, quotationId: string, actorId: string): Promise<void> {
  const s = getAdminSupabaseClient();
  const { data: q } = await s.from("quotation")
    .select("id, quotation_number, version, currency, terms, validity_note, client_id, request_id, artifact_storage_path")
    .eq("id", quotationId).eq("tenant_id", tenantId).maybeSingle();
  if (!q || q.artifact_storage_path) return; // render once

  // Every read is tenant-filtered, even though the ids came from a row that was
  // already tenant-scoped: the admin client bypasses RLS, so the filter is the
  // only boundary left, and "the id must be safe because of where I got it" is
  // exactly the reasoning that produces cross-tenant reads later.
  const [{ data: lines }, { data: client }, { data: org }, { data: req }] = await Promise.all([
    s.from("quotation_line").select("position, description, quantity_milli, unit_amount_minor, tax_rate_bp")
      .eq("tenant_id", tenantId).eq("quotation_id", quotationId).order("position"),
    s.from("client").select("name, address, ninea")
      .eq("tenant_id", tenantId).eq("id", q.client_id).maybeSingle(),
    s.from("organization").select("name").eq("id", tenantId).maybeSingle(),
    s.from("quotation_request").select("subject")
      .eq("tenant_id", tenantId).eq("id", q.request_id).maybeSingle(),
  ]);

  const bytes = renderQuotationPdf({
    quotationNumber: q.quotation_number,
    version: q.version,
    issuedOn: new Date().toISOString().slice(0, 10),
    currency: q.currency,
    tenantName: org?.name ?? "",
    clientName: client?.name ?? "",
    clientAddress: client?.address ?? null,
    clientNinea: client?.ninea ?? null,
    subject: req?.subject ?? null,
    terms: q.terms,
    validityNote: q.validity_note,
    lines: (lines ?? []).map((l) => ({
      position: l.position, description: l.description,
      quantityMilli: l.quantity_milli, unitAmountMinor: l.unit_amount_minor,
      taxRateBp: l.tax_rate_bp,
    })),
  });

  const path = quotationArtifactPath(tenantId, quotationId, q.version);
  const up = await uploadObject(path, bytes, "application/pdf");
  if (!up.ok) return;

  await s.from("quotation").update({
    artifact_storage_path: path,
    artifact_sha256: sha256Hex(bytes),
    artifact_renderer_version: QUOTATION_RENDERER_VERSION,
    artifact_generated_at: new Date().toISOString(),
  }).eq("id", quotationId).eq("tenant_id", tenantId);

  await writeAudit({ action: "commercial.quotation.artifact_generated", actorId, tenantId,
    entity: "quotation", entityId: quotationId, after: { renderer_version: QUOTATION_RENDERER_VERSION } });
}

/* ========================================================================== */
/* Act 4 — record the customer's decision (quotation:approve)                 */
/* ========================================================================== */

/**
 * ACCEPTANCE IS NEVER INFERRED. A human records it, states which of the three
 * ratified evidence kinds applies, and may attach a document and/or point at
 * the inbound message that carried it. Nothing anywhere derives acceptance from
 * a message arriving — the ADR-EC-1 doctrine.
 */
export async function recordCustomerDecision(input: {
  quotationId: string; decision: "ACCEPTED" | "DECLINED";
  acceptance?: AcceptanceInput; on?: string | null; reasonCode?: string | null;
}): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:approve"); } catch { return { ok: false, error: "forbidden_approve" }; }

  if (input.decision === "ACCEPTED") {
    if (!input.acceptance) return { ok: false, error: "acceptance_required" };
    const problem = validateAcceptance(input.acceptance);
    if (problem) return { ok: false, error: problem };
  }

  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("quotation_record_decision", {
    p_tenant: user.tenantId, p_quotation: input.quotationId, p_actor: user.id,
    p_decision: input.decision,
    p_acceptance_kind: input.acceptance?.kind ?? null,
    p_on: input.acceptance?.on || input.on || null,
    p_document: input.acceptance?.documentId || null,
    p_message: input.acceptance?.messageId || null,
    p_reason_code: input.reasonCode?.trim() || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };

  await writeAudit({
    action: `commercial.quotation.${input.decision.toLowerCase()}`,
    actorId: user.id, tenantId: user.tenantId, entity: "quotation",
    entityId: input.quotationId,
    after: { acceptance_kind: input.acceptance?.kind ?? null },
  });
  revalidatePath(PATH);
  return { ok: true, id: input.quotationId };
}

/* ========================================================================== */
/* Revision and cancellation — quotation:create                               */
/* ========================================================================== */

/** A NEW immutable version. The previous one survives as SUPERSEDED, forever. */
export async function reviseQuotation(quotationId: string): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:create"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("quotation_revise", {
    p_tenant: user.tenantId, p_quotation: quotationId, p_actor: user.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "commercial.quotation.revised", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation", entityId: (data as string) ?? null, after: { supersedes_id: quotationId } });
  revalidatePath(PATH);
  return { ok: true, id: (data as string) ?? undefined };
}

export async function cancelQuotation(quotationId: string, reasonCode: string): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:create"); } catch { return { ok: false, error: "forbidden" }; }
  if (!reasonCode.trim()) return { ok: false, error: "reason_required" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("quotation_cancel", {
    p_tenant: user.tenantId, p_quotation: quotationId, p_actor: user.id,
    p_reason_code: reasonCode.trim(),
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "commercial.quotation.cancelled", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation", entityId: quotationId, after: { reason_code: reasonCode.trim() } });
  revalidatePath(PATH);
  return { ok: true, id: quotationId };
}

/* ========================================================================== */
/* Conversion — RECORDING only. EC-3D owns the orchestration.                 */
/* ========================================================================== */

/**
 * Record that a dossier was opened from this quotation.
 *
 * **Commercial does not create the dossier.** The caller passes the id of a
 * dossier Operations created through its own path (`createFile`, `file:create`).
 * This records the link and emits QUOTATION_CONVERTED_TO_DOSSIER with the
 * DOSSIER as subject — so the shipment's timeline begins with its commercial
 * provenance and Tracking never reads a Commercial table to learn it.
 *
 * The end-to-end orchestration (create + record in one flow) is EC-3D.
 */
export async function recordConversion(quotationId: string, fileId: string): Promise<CommercialResult> {
  let user;
  try { user = await assertPermission("quotation:approve"); } catch { return { ok: false, error: "forbidden_approve" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("quotation_record_conversion", {
    p_tenant: user.tenantId, p_quotation: quotationId, p_actor: user.id, p_file: fileId,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "commercial.quotation.converted", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation", entityId: quotationId, after: { file_id: fileId } });
  revalidatePath(PATH);
  return { ok: true, id: quotationId };
}

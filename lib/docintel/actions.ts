"use server";

/**
 * Document Intelligence — server actions (Phase 7.4A). AI/OCR output are SUGGESTIONS.
 * create/run/review mutate ONLY the intelligence tables (gated by document:update). APPLY is
 * the only path to operational records, and it routes through the EXISTING domain services
 * (which re-check the target-domain permission + own the invariant) — never a free-form table
 * write. Tenant + actor from the session. Audit carries safe metadata only (never values/text).
 */
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { downloadObject } from "@/lib/documents/storage";
import { defaultEngine } from "./provider";
import { sanitizeText, deterministicExtractPages, type CandidateField } from "./extract";
import { parseSearchablePdf } from "./pdf/parser";
import { classifyText } from "./classify-text";
import { classifyDocument } from "./classify";
import { fieldSchema } from "./schemas";
import { normalizeField, validateFieldFormat, reconcileWithOperational } from "./validate";
import { classFromTypeCode, isDocClass, type DocClass } from "./types";
import { updateBookingBl } from "@/lib/shipping/intelligence/manage-actions";
import { updateAwb } from "@/lib/air/intelligence/manage-actions";
import type { Database } from "@/lib/db/types";

const STORED_TEXT_MAX = 40_000;

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type FieldUpdate = Database["public"]["Tables"]["document_candidate_field"]["Update"];
export type DocIntelResult = { ok: true; id?: string; count?: number } | { ok: false; error: string };
export type ApplyResult = { ok: true; results: { fieldId: string; fieldKey: string; result: string }[] } | { ok: false; error: string };

async function loadDoc(admin: Admin, documentId: string, tenantId: string) {
  const { data } = await admin.from("document").select("id, file_id, type_code, version, storage_path, mime_type, size_bytes").eq("id", documentId).eq("tenant_id", tenantId).is("deleted_at", null).maybeSingle<{ id: string; file_id: string; type_code: string; version: number; storage_path: string; mime_type: string | null; size_bytes: number | null }>();
  return data ?? null;
}

type JobRef = { id: string; document_id: string; job_version: number };
/** Move a job to FAILED with a bounded failure_category (never a raw provider error) + CAS. */
async function failJob(admin: Admin, user: { id: string; tenantId: string }, job: JobRef, code: string): Promise<{ ok: false; error: string }> {
  await admin.from("document_intelligence_job").update({ status: "FAILED", failure_category: code, job_version: job.job_version + 1 }).eq("id", job.id).eq("tenant_id", user.tenantId).eq("job_version", job.job_version);
  await writeAudit({ action: AuditActions.DOCUMENT_EXTRACTION_FAILED, actorId: user.id, tenantId: user.tenantId, entity: "document", entityId: job.document_id, after: { jobId: job.id, category: code } });
  return { ok: false, error: code };
}

/** Reconcile candidate fields against the current operational shipment/AWB (bounded read) and
 *  shape them into candidate rows. Reused by manual + PDF extraction. */
async function buildCandidateRows(admin: Admin, tenantId: string, fileId: string, jobId: string, cls: DocClass, candidates: CandidateField[]) {
  const { data: ship } = await admin.from("shipment").select("id, master_bl, booking_reference").eq("file_id", fileId).eq("tenant_id", tenantId).maybeSingle<{ id: string; master_bl: string | null; booking_reference: string | null }>();
  const { data: awb } = ship ? await admin.from("air_awb").select("mawb, hawb").eq("shipment_id", ship.id).eq("tenant_id", tenantId).maybeSingle<{ mawb: string | null; hawb: string | null }>() : { data: null };
  const opValue = (target: string | null): string | null => {
    switch (target) { case "shipping.masterBl": return ship?.master_bl ?? null; case "shipping.bookingReference": return ship?.booking_reference ?? null; case "air.mawb": return awb?.mawb ?? null; case "air.hawb": return awb?.hawb ?? null; default: return null; }
  };
  return candidates.map((c) => {
    const fs = fieldSchema(cls, c.fieldKey);
    const target = fs?.applyTarget ? `${fs.applyTarget.domain}.${fs.applyTarget.field}` : null;
    const recon = target ? reconcileWithOperational(c.normalizedValue, opValue(target)) : "NONE";
    return { tenant_id: tenantId, job_id: jobId, file_id: fileId, document_class: cls, field_key: c.fieldKey, displayed_value: c.displayedValue, normalized_value: c.normalizedValue, confidence: c.confidence, page: c.page, evidence: c.evidence, validation_status: c.validationStatus, reconciliation_status: recon, application_target: target };
  });
}

/** Create an extraction job for a document's current (immutable) version. Idempotent: an
 *  active job for the same version is returned rather than duplicated. */
export async function createIntelligenceJob(documentId: string): Promise<DocIntelResult> {
  let user; try { user = await assertPermission("document:update"); } catch { return { ok: false, error: "forbidden" }; }
  const admin = getAdminSupabaseClient();
  const doc = await loadDoc(admin, documentId, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, doc.file_id))) return { ok: false, error: "forbidden" };

  const engine = defaultEngine();
  const declared = classFromTypeCode(doc.type_code);
  const cls = engine.classify(declared);

  const { data: existing } = await admin.from("document_intelligence_job").select("id").eq("tenant_id", user.tenantId).eq("document_id", documentId).eq("document_version", doc.version).not("status", "in", "(APPLIED,FAILED,CANCELLED)").maybeSingle<{ id: string }>();
  if (existing) return { ok: true, id: existing.id };

  const { data, error } = await admin.from("document_intelligence_job").insert({
    tenant_id: user.tenantId, document_id: documentId, file_id: doc.file_id, document_version: doc.version,
    storage_path: doc.storage_path, mime_type: doc.mime_type, byte_size: doc.size_bytes,
    declared_class: cls.finalClass, classification_confidence: cls.confidence, status: "QUEUED", provider_code: "manual", created_by: user.id,
  }).select("id");
  if (error) return { ok: false, error: error.code === "23505" ? "active_job_exists" : error.message };
  const jobId = data?.[0]?.id;
  await writeAudit({ action: AuditActions.DOCUMENT_INTELLIGENCE_REQUESTED, actorId: user.id, tenantId: user.tenantId, entity: "document", entityId: documentId, after: { documentClass: cls.finalClass, jobId } });
  await writeAudit({ action: AuditActions.DOCUMENT_CLASSIFIED, actorId: user.id, tenantId: user.tenantId, entity: "document", entityId: documentId, after: { documentClass: cls.finalClass, confidence: cls.confidence } });
  revalidatePath(`/files/${doc.file_id}`);
  return { ok: true, id: jobId };
}

/** Run extraction SYNCHRONOUSLY over operator-provided text (no OCR/AI). Produces validated,
 *  reconciled candidate fields and moves the job to READY_FOR_REVIEW (or FAILED). */
export async function runExtraction(jobId: string, providedText: string): Promise<DocIntelResult> {
  let user; try { user = await assertPermission("document:update"); } catch { return { ok: false, error: "forbidden" }; }
  const admin = getAdminSupabaseClient();
  const { data: job } = await admin.from("document_intelligence_job").select("id, document_id, file_id, document_version, status, declared_class, mime_type, byte_size, job_version").eq("id", jobId).eq("tenant_id", user.tenantId).maybeSingle<{ id: string; document_id: string; file_id: string; document_version: number; status: string; declared_class: string | null; mime_type: string | null; byte_size: number | null; job_version: number }>();
  if (!job) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, job.file_id))) return { ok: false, error: "forbidden" };
  if (job.status !== "QUEUED") return { ok: false, error: "not_queued" };

  const doc = await loadDoc(admin, job.document_id, user.tenantId);
  if (!doc || doc.version !== job.document_version) return { ok: false, error: "document_changed" }; // source replaced ⇒ new job required

  const cls = (job.declared_class && isDocClass(job.declared_class) ? job.declared_class : "UNKNOWN") as DocClass;
  const engine = defaultEngine();

  const textRes = await engine.extractText({ mimeType: job.mime_type, byteSize: job.byte_size, providedText });
  if (!textRes.ok) return failJob(admin, user, job, textRes.code);
  const text = textRes.data.pages.join("\n");
  const fieldsRes = await engine.extractFields(cls, text);
  if (!fieldsRes.ok) return failJob(admin, user, job, fieldsRes.code);

  const rows = await buildCandidateRows(admin, user.tenantId, job.file_id, jobId, cls, fieldsRes.data.candidates);
  if (rows.length > 0) {
    const { error: insErr } = await admin.from("document_candidate_field").upsert(rows, { onConflict: "tenant_id,job_id,field_key" });
    if (insErr) return { ok: false, error: insErr.message };
  }

  const { data: upd, error: updErr } = await admin.from("document_intelligence_job").update({ status: "READY_FOR_REVIEW", extraction_method: fieldsRes.data.method, extracted_text: sanitizeText(text), job_version: job.job_version + 1 }).eq("id", jobId).eq("tenant_id", user.tenantId).eq("job_version", job.job_version).select("id");
  if (updErr) return { ok: false, error: updErr.message };
  if (!upd || upd.length === 0) return { ok: false, error: "stale_job" };

  await writeAudit({ action: AuditActions.DOCUMENT_EXTRACTION_COMPLETED, actorId: user.id, tenantId: user.tenantId, entity: "document", entityId: job.document_id, after: { jobId, documentClass: cls, fieldCount: rows.length, provider: engine.structuredProvider } });
  revalidatePath(`/files/${job.file_id}/documents/${job.document_id}`);
  return { ok: true, id: jobId, count: rows.length };
}

/**
 * Extract a SEARCHABLE PDF's embedded text layer ENTIRELY LOCALLY (Phase 7.4B) — no OCR, no
 * LLM, no external call. Validates file/version, downloads the bytes, checksums them, parses the
 * text layer (page-preserving), deterministically classifies FR/EN (a suggestion — the declared
 * class stays authoritative), extracts + reconciles candidate fields, and moves the job to
 * READY_FOR_REVIEW. A scanned / image-only PDF has no text layer ⇒ the job FAILS with OCR_REQUIRED.
 */
export async function extractSearchablePdf(jobId: string): Promise<DocIntelResult> {
  let user; try { user = await assertPermission("document:update"); } catch { return { ok: false, error: "forbidden" }; }
  const admin = getAdminSupabaseClient();
  const { data: job } = await admin.from("document_intelligence_job").select("id, document_id, file_id, document_version, status, declared_class, job_version").eq("id", jobId).eq("tenant_id", user.tenantId).maybeSingle<{ id: string; document_id: string; file_id: string; document_version: number; status: string; declared_class: string | null; job_version: number }>();
  if (!job) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, job.file_id))) return { ok: false, error: "forbidden" };
  if (job.status !== "QUEUED") return { ok: false, error: "not_queued" };

  const doc = await loadDoc(admin, job.document_id, user.tenantId);
  if (!doc || doc.version !== job.document_version) return { ok: false, error: "document_changed" }; // source replaced ⇒ new job
  if (doc.mime_type !== "application/pdf") return failJob(admin, user, job, "UNSUPPORTED_FILE");
  if (!doc.storage_path) return failJob(admin, user, job, "UNSUPPORTED_FILE");

  const bytes = await downloadObject(doc.storage_path);
  if (!bytes) return failJob(admin, user, job, "PROVIDER_ERROR");
  const checksum = createHash("sha256").update(bytes).digest("hex");

  const parsed = await parseSearchablePdf(bytes, { mimeType: doc.mime_type, byteSize: doc.size_bytes });
  if (!parsed.ok) return failJob(admin, user, job, parsed.code); // OCR_REQUIRED for scanned/image-only

  // Deterministic FR/EN classification (a SUGGESTION). Declared class stays authoritative.
  const declared = (job.declared_class && isDocClass(job.declared_class) ? job.declared_class : null) as DocClass | null;
  const predicted = classifyText(parsed.pages.join("\n"));
  const classification = classifyDocument({ declaredClass: declared, predictedClass: predicted.predictedClass, predictedConfidence: predicted.confidence });
  const cls = classification.finalClass;

  const candidates = deterministicExtractPages(cls, parsed.pages);
  const rows = await buildCandidateRows(admin, user.tenantId, job.file_id, jobId, cls, candidates);
  if (rows.length > 0) {
    const { error: insErr } = await admin.from("document_candidate_field").upsert(rows, { onConflict: "tenant_id,job_id,field_key" });
    if (insErr) return { ok: false, error: insErr.message };
  }

  const storedText = parsed.pages.map((p) => sanitizeText(p)).join("\f").slice(0, STORED_TEXT_MAX); // \f = page boundary
  const { data: upd, error: updErr } = await admin.from("document_intelligence_job").update({
    status: "READY_FOR_REVIEW", provider_code: "local_pdf_text", extraction_method: "pdf_text_layer",
    predicted_class: predicted.predictedClass, classification_confidence: classification.confidence,
    extracted_text: storedText, page_count: parsed.pageCount, checksum, job_version: job.job_version + 1,
  }).eq("id", jobId).eq("tenant_id", user.tenantId).eq("job_version", job.job_version).select("id");
  if (updErr) return { ok: false, error: updErr.message };
  if (!upd || upd.length === 0) return { ok: false, error: "stale_job" };

  await writeAudit({ action: AuditActions.DOCUMENT_CLASSIFIED, actorId: user.id, tenantId: user.tenantId, entity: "document", entityId: job.document_id, after: { jobId, predictedClass: predicted.predictedClass, confidence: classification.confidence, language: predicted.language, conflict: classification.conflict } });
  await writeAudit({ action: AuditActions.DOCUMENT_EXTRACTION_COMPLETED, actorId: user.id, tenantId: user.tenantId, entity: "document", entityId: job.document_id, after: { jobId, documentClass: cls, fieldCount: rows.length, pageCount: parsed.pageCount, provider: "local_pdf_text" } });
  revalidatePath(`/files/${job.file_id}/documents/${job.document_id}`);
  return { ok: true, id: jobId, count: rows.length };
}

/** Record a human review decision on one candidate field. EDITED values are re-validated and
 *  recorded as HUMAN edits (not AI output). */
export async function reviewField(fieldId: string, decision: string, editedValue?: string): Promise<DocIntelResult> {
  let user; try { user = await assertPermission("document:update"); } catch { return { ok: false, error: "forbidden" }; }
  if (!["APPROVED", "REJECTED", "EDITED", "IGNORED"].includes(decision)) return { ok: false, error: "invalid_decision" };
  const admin = getAdminSupabaseClient();
  const { data: field } = await admin.from("document_candidate_field").select("id, job_id, file_id, document_class, field_key").eq("id", fieldId).eq("tenant_id", user.tenantId).maybeSingle<{ id: string; job_id: string; file_id: string; document_class: string; field_key: string }>();
  if (!field) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, field.file_id))) return { ok: false, error: "forbidden" };

  const patch: Record<string, unknown> = { review_decision: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString() };
  if (decision === "EDITED") {
    const fs = isDocClass(field.document_class) ? fieldSchema(field.document_class as DocClass, field.field_key) : null;
    if (!fs) return { ok: false, error: "invalid_field" };
    const norm = normalizeField(fs.kind, editedValue ?? "");
    if (norm == null) return { ok: false, error: "invalid_value" };
    patch.edited_value = norm;
    patch.validation_status = validateFieldFormat(fs.kind, norm);
  }
  const { error } = await admin.from("document_candidate_field").update(patch as FieldUpdate).eq("id", fieldId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  // Advance the job: PARTIALLY_APPROVED while some remain PENDING, APPROVED when none do.
  const { data: pend } = await admin.from("document_candidate_field").select("id", { count: "exact", head: false }).eq("tenant_id", user.tenantId).eq("job_id", field.job_id).eq("review_decision", "PENDING").returns<{ id: string }[]>();
  const nextStatus = (pend?.length ?? 0) === 0 ? "APPROVED" : "PARTIALLY_APPROVED";
  await admin.from("document_intelligence_job").update({ status: nextStatus }).eq("id", field.job_id).eq("tenant_id", user.tenantId).in("status", ["READY_FOR_REVIEW", "PARTIALLY_APPROVED"]);

  await writeAudit({ action: AuditActions.DOCUMENT_REVIEW_COMPLETED, actorId: user.id, tenantId: user.tenantId, entity: "document_candidate_field", entityId: fieldId, after: { fieldKey: field.field_key, decision } });
  revalidatePath(`/files/${field.file_id}`);
  return { ok: true, id: fieldId };
}

/** Apply selected APPROVED/EDITED fields through the existing domain services. Per-field
 *  outcomes; a failure on one never erases decisions or blocks the others. */
export async function applyFields(jobId: string, fieldIds: string[]): Promise<ApplyResult> {
  let user; try { user = await assertPermission("document:read"); } catch { return { ok: false, error: "forbidden" }; }
  if (!Array.isArray(fieldIds) || fieldIds.length === 0) return { ok: false, error: "no_fields" };
  const admin = getAdminSupabaseClient();
  const { data: job } = await admin.from("document_intelligence_job").select("id, document_id, file_id, document_version").eq("id", jobId).eq("tenant_id", user.tenantId).maybeSingle<{ id: string; document_id: string; file_id: string; document_version: number }>();
  if (!job) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, job.file_id))) return { ok: false, error: "forbidden" };
  const doc = await loadDoc(admin, job.document_id, user.tenantId);
  if (!doc || doc.version !== job.document_version) return { ok: false, error: "document_changed" }; // stale source

  const { data: ship } = await admin.from("shipment").select("id").eq("file_id", job.file_id).eq("tenant_id", user.tenantId).maybeSingle<{ id: string }>();
  const { data: fields } = await admin.from("document_candidate_field").select("id, field_key, normalized_value, edited_value, review_decision, application_target").eq("tenant_id", user.tenantId).eq("job_id", jobId).in("id", fieldIds).returns<{ id: string; field_key: string; normalized_value: string | null; edited_value: string | null; review_decision: string; application_target: string | null }[]>();

  const results: { fieldId: string; fieldKey: string; result: string }[] = [];
  for (const f of fields ?? []) {
    let result = "SKIPPED";
    if (f.review_decision !== "APPROVED" && f.review_decision !== "EDITED") result = "SKIPPED";
    else if (!f.application_target) result = "UNSUPPORTED";
    else if (!ship) result = "FAILED";
    else {
      const value = f.edited_value ?? f.normalized_value ?? "";
      // Route through the domain service that OWNS the invariant + re-checks the permission.
      const res = f.application_target === "shipping.masterBl" ? await updateBookingBl(ship.id, { masterBl: value })
        : f.application_target === "shipping.bookingReference" ? await updateBookingBl(ship.id, { bookingReference: value })
        : f.application_target === "air.mawb" ? await updateAwb(ship.id, { mawb: value })
        : f.application_target === "air.hawb" ? await updateAwb(ship.id, { hawb: value })
        : { ok: false as const, error: "unsupported" };
      result = res.ok ? "APPLIED" : "FAILED";
      await writeAudit({ action: res.ok ? AuditActions.DOCUMENT_FIELD_APPLIED : AuditActions.DOCUMENT_FIELD_APPLICATION_FAILED, actorId: user.id, tenantId: user.tenantId, entity: "document_candidate_field", entityId: f.id, after: { fieldKey: f.field_key, target: f.application_target, outcome: result } });
    }
    await admin.from("document_candidate_field").update({ application_result: result, applied_at: result === "APPLIED" ? new Date().toISOString() : null }).eq("id", f.id).eq("tenant_id", user.tenantId);
    results.push({ fieldId: f.id, fieldKey: f.field_key, result });
  }

  // Mark the job APPLIED only when nothing is left pending/approved-unapplied.
  const { data: remaining } = await admin.from("document_candidate_field").select("id").eq("tenant_id", user.tenantId).eq("job_id", jobId).in("review_decision", ["APPROVED", "EDITED"]).is("application_result", null).returns<{ id: string }[]>();
  if ((remaining?.length ?? 0) === 0) await admin.from("document_intelligence_job").update({ status: "APPLIED" }).eq("id", jobId).eq("tenant_id", user.tenantId).in("status", ["APPROVED", "PARTIALLY_APPROVED"]);

  revalidatePath(`/files/${job.file_id}`);
  return { ok: true, results };
}

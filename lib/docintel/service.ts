/**
 * Document Intelligence — reads (Phase 7.4A). SERVER-ONLY. Admin client gated by
 * document:read + dossier visibility; tenant-filtered (leak guard). No provider call here.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible, resolveFileScope } from "@/lib/authz/visibility";
import { buildDocIntelDashboard, type DocIntelDashboard } from "./dashboard";
import { docIntelProviders, type DocIntelProviderConfig } from "./provider";
import type { DocClass, JobStatus, Confidence, ValidationStatus, ReviewDecision } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
const JOB_COLS = "id, document_id, file_id, document_version, status, declared_class, predicted_class, classification_confidence, provider_code, extraction_method, failure_category, job_version, created_at";
const FIELD_COLS = "id, job_id, document_class, field_key, displayed_value, normalized_value, confidence, page, evidence, validation_status, reconciliation_status, review_decision, edited_value, reviewed_by, application_target, application_result";

export type JobView = { id: string; documentId: string; fileId: string; documentVersion: number; status: JobStatus; declaredClass: DocClass | null; predictedClass: DocClass | null; classificationConfidence: Confidence | null; providerCode: string; extractionMethod: string | null; failureCategory: string | null; jobVersion: number };
export type CandidateView = { id: string; jobId: string; documentClass: DocClass; fieldKey: string; displayedValue: string | null; normalizedValue: string | null; confidence: Confidence; page: number | null; evidence: string | null; validationStatus: ValidationStatus; reconciliationStatus: string | null; reviewDecision: ReviewDecision; editedValue: string | null; applicationTarget: string | null; applicationResult: string | null };

function jobView(r: Record<string, unknown>): JobView {
  return { id: r.id as string, documentId: r.document_id as string, fileId: r.file_id as string, documentVersion: r.document_version as number, status: r.status as JobStatus, declaredClass: (r.declared_class as DocClass | null) ?? null, predictedClass: (r.predicted_class as DocClass | null) ?? null, classificationConfidence: (r.classification_confidence as Confidence | null) ?? null, providerCode: r.provider_code as string, extractionMethod: (r.extraction_method as string | null) ?? null, failureCategory: (r.failure_category as string | null) ?? null, jobVersion: r.job_version as number };
}
function fieldView(r: Record<string, unknown>): CandidateView {
  return { id: r.id as string, jobId: r.job_id as string, documentClass: r.document_class as DocClass, fieldKey: r.field_key as string, displayedValue: (r.displayed_value as string | null) ?? null, normalizedValue: (r.normalized_value as string | null) ?? null, confidence: r.confidence as Confidence, page: (r.page as number | null) ?? null, evidence: (r.evidence as string | null) ?? null, validationStatus: r.validation_status as ValidationStatus, reconciliationStatus: (r.reconciliation_status as string | null) ?? null, reviewDecision: r.review_decision as ReviewDecision, editedValue: (r.edited_value as string | null) ?? null, applicationTarget: (r.application_target as string | null) ?? null, applicationResult: (r.application_result as string | null) ?? null };
}

export type DocumentIntelligence = { document: { id: string; typeCode: string; title: string | null; fileId: string; fileNumber: string | null; version: number; mimeType: string | null } | null; job: JobView | null; candidates: CandidateView[]; providers: DocIntelProviderConfig[] };

/** The latest job + candidates for one document (the review studio's data). */
export async function getDocumentIntelligence(documentId: string): Promise<DocumentIntelligence | null> {
  const user = await assertPermission("document:read");
  const admin = getAdminSupabaseClient();
  const { data: doc } = await admin.from("document").select("id, type_code, title, file_id, version, mime_type, file:file_id(file_number)").eq("id", documentId).eq("tenant_id", user.tenantId).is("deleted_at", null).maybeSingle<{ id: string; type_code: string; title: string | null; file_id: string; version: number; mime_type: string | null; file: { file_number: string } | null }>();
  if (!doc) return null;
  if (!(await isFileVisible(user.id, user.tenantId, doc.file_id))) return null;

  const { data: jobs } = await admin.from("document_intelligence_job").select(JOB_COLS).eq("tenant_id", user.tenantId).eq("document_id", documentId).order("created_at", { ascending: false }).limit(1).returns<Record<string, unknown>[]>();
  const job = jobs?.[0] ? jobView(jobs[0]) : null;
  let candidates: CandidateView[] = [];
  if (job) {
    const { data: fields } = await admin.from("document_candidate_field").select(FIELD_COLS).eq("tenant_id", user.tenantId).eq("job_id", job.id).order("field_key", { ascending: true }).returns<Record<string, unknown>[]>();
    candidates = (fields ?? []).map(fieldView);
  }
  return { document: { id: doc.id, typeCode: doc.type_code, title: doc.title, fileId: doc.file_id, fileNumber: doc.file?.file_number ?? null, version: doc.version, mimeType: doc.mime_type }, job, candidates, providers: docIntelProviders() };
}

/** Bounded review-queue summary for the dossier + Command Center indicator. */
export type ReviewQueueSummary = { readyForReview: number; failed: number; unresolvedConflicts: number; capped: boolean };
const CAP = 500;
export async function getReviewQueueSummary(): Promise<ReviewQueueSummary> {
  const user = await assertPermission("document:read");
  const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
  if (!scope.all && scope.ids.length === 0) return { readyForReview: 0, failed: 0, unresolvedConflicts: 0, capped: false };
  const admin = getAdminSupabaseClient();
  let q = admin.from("document_intelligence_job").select("status, file_id").eq("tenant_id", user.tenantId);
  if (!scope.all) q = q.in("file_id", scope.ids);
  const { data } = await q.order("updated_at", { ascending: false }).range(0, CAP).returns<{ status: string; file_id: string }[]>();
  const rows = data ?? [];
  return {
    readyForReview: rows.filter((r) => r.status === "READY_FOR_REVIEW" || r.status === "PARTIALLY_APPROVED").length,
    failed: rows.filter((r) => r.status === "FAILED").length,
    unresolvedConflicts: 0,
    capped: rows.length > CAP,
  };
}

/** Pure-contract dashboard over a bounded, scoped working set. */
export async function getDocIntelDashboard(): Promise<DocIntelDashboard> {
  const user = await assertPermission("document:read");
  const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
  if (!scope.all && scope.ids.length === 0) return buildDocIntelDashboard([], []);
  const admin = getAdminSupabaseClient();
  let jq = admin.from("document_intelligence_job").select("status, declared_class, file_id").eq("tenant_id", user.tenantId);
  if (!scope.all) jq = jq.in("file_id", scope.ids);
  const { data: jobs } = await jq.range(0, CAP).returns<{ status: string; declared_class: string | null; file_id: string }[]>();
  const jobRows = (jobs ?? []).map((j) => ({ status: j.status as JobStatus, documentClass: (j.declared_class as DocClass) ?? "UNKNOWN" }));
  return buildDocIntelDashboard(jobRows, []);
}

/**
 * Logistics Copilot — bounded server-only readers (Phase 7.6B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Missing-REQUIRED-document analysis (distinct from the OCR review queue) and a SAFE
 * Document-Intelligence projection (states/counts only — never extracted values, text, evidence
 * excerpts, or parser errors). Both are tenant-scoped, page-0, ≤ cap, and batched (no N+1).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { CopilotDocIntelJob, CopilotMissingDoc, RequirementState } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
const APPROVED = "APPROVED";

/**
 * Portfolio missing-required-documents over a bounded set of recent files. Distinguishes
 * required-and-MISSING, required-and-EXPIRED, and uploaded-but-AWAITING_REVIEW — none of which is
 * the OCR review queue. Reuses the existing document_type.required_for catalog + file documents.
 */
export async function readMissingRequiredDocs(admin: Admin, tenantId: string, cap: number): Promise<CopilotMissingDoc[]> {
  const { data: files } = await admin
    .from("operational_file")
    .select("id, file_number, type")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .range(0, cap)
    .returns<{ id: string; file_number: string | null; type: string }[]>();
  const fileRows = files ?? [];
  if (fileRows.length === 0) return [];

  const [{ data: types }, { data: docs }] = await Promise.all([
    admin.from("document_type").select("code, required_for, label_fr").eq("active", true).returns<{ code: string; required_for: string[] | null; label_fr: string | null }[]>(),
    admin.from("document").select("file_id, type_code, status, expiry_date").eq("tenant_id", tenantId).in("file_id", fileRows.map((f) => f.id)).is("deleted_at", null).returns<{ file_id: string; type_code: string; status: string; expiry_date: string | null }[]>(),
  ]);
  const typeRows = types ?? [];
  const labelByCode = new Map(typeRows.map((t) => [t.code, t.label_fr ?? t.code] as const));
  const nowMs = Date.now();

  const out: CopilotMissingDoc[] = [];
  for (const f of fileRows) {
    if (out.length >= cap) break;
    const requiredCodes = typeRows.filter((t) => (t.required_for ?? []).includes(f.type)).map((t) => t.code);
    const fileDocs = (docs ?? []).filter((d) => d.file_id === f.id);
    for (const code of requiredCodes) {
      const ofType = fileDocs.filter((d) => d.type_code === code);
      const approved = ofType.filter((d) => d.status === APPROVED);
      let state: RequirementState | null = null;
      let due: string | null = null;
      if (ofType.length === 0) state = "MISSING";
      else if (approved.some((d) => d.expiry_date && new Date(d.expiry_date).getTime() < nowMs)) { state = "EXPIRED"; due = approved.find((d) => d.expiry_date && new Date(d.expiry_date).getTime() < nowMs)?.expiry_date ?? null; }
      else if (approved.length > 0) state = null; // satisfied
      else state = "AWAITING_REVIEW";
      if (state) out.push({ fileNumber: f.file_number, fileId: f.id, documentType: labelByCode.get(code) ?? code, state, due, link: `/files/${f.id}` });
      if (out.length >= cap) break;
    }
  }
  return out;
}

/**
 * Safe Document-Intelligence projection: job states + counts, NEVER values/text. Covers
 * ready-for-review, OCR_REQUIRED, extraction failure, and unresolved conflicts.
 */
export async function readDocIntelJobs(admin: Admin, tenantId: string, cap: number): Promise<CopilotDocIntelJob[]> {
  const { data: jobs } = await admin
    .from("document_intelligence_job")
    .select("id, document_id, file_id, declared_class, predicted_class, status, failure_category, file:file_id(file_number)")
    .eq("tenant_id", tenantId)
    .in("status", ["READY_FOR_REVIEW", "PARTIALLY_APPROVED", "FAILED"])
    .order("updated_at", { ascending: false })
    .range(0, cap)
    .returns<{ id: string; document_id: string; file_id: string; declared_class: string | null; predicted_class: string | null; status: string; failure_category: string | null; file: { file_number: string | null } | null }[]>();
  const jobRows = jobs ?? [];
  if (jobRows.length === 0) return [];

  const { data: cands } = await admin
    .from("document_candidate_field")
    .select("job_id, reconciliation_status")
    .eq("tenant_id", tenantId)
    .in("job_id", jobRows.map((j) => j.id))
    .returns<{ job_id: string; reconciliation_status: string | null }[]>();
  const byJob = new Map<string, { total: number; conflicts: number }>();
  for (const c of cands ?? []) {
    const a = byJob.get(c.job_id) ?? { total: 0, conflicts: 0 };
    a.total++;
    if (c.reconciliation_status === "CONFLICT") a.conflicts++;
    byJob.set(c.job_id, a);
  }

  return jobRows.map((j): CopilotDocIntelJob => {
    const agg = byJob.get(j.id) ?? { total: 0, conflicts: 0 };
    return {
      fileNumber: j.file?.file_number ?? null,
      documentId: j.document_id,
      declaredType: j.declared_class,
      predictedType: j.predicted_class,
      state: j.status,
      ocrRequired: j.failure_category === "OCR_REQUIRED",
      failureCategory: j.status === "FAILED" ? j.failure_category : null,
      conflictCount: agg.conflicts,
      candidateCount: agg.total,
      link: `/files/${j.file_id}/documents/${j.document_id}/intelligence`,
    };
  });
}

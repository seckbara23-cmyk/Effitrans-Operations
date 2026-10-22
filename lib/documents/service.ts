/**
 * Document reads (Phase 1.8). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Service-role admin client (privileged read, gated by assertPermission +
 * dossier visibility) — documents embed type label + uploader/reviewer email,
 * which carry their own RLS a user-context embed can't satisfy. The document
 * RLS SELECT policy (tenant + document:read + can_read_file + not deleted) is
 * the CI-tested boundary. Soft-deleted rows are excluded.
 */
import { isGeneratableArtifact } from "./artifacts/feasibility";
import { missingDocumentationEvidence } from "./requirements";
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { classifyExpiry } from "./expiry";
import { expiryGovernanceAvailable } from "./expiry-governance-161";
import { summarizeExpiryHistory, type ExpiryHistoryEntry } from "./expiry-change";
import type { DocumentItem, DocumentStatus, DocumentTypeItem, MissingDocument } from "./types";

type ExpiryRow = {
  id: string;
  document_id: string;
  kind: ExpiryHistoryEntry["kind"];
  proposal_id: string | null;
  old_expiry: string | null;
  new_expiry: string | null;
  reason: string | null;
  actor_id: string;
  occurred_at: string;
  actor: { email: string | null } | null;
};

/**
 * CEO-ALIGNMENT WP1-E — the governed expiry history for a dossier's documents,
 * keyed by document. One batched read for the whole dossier, tenant- and
 * dossier-scoped, and only once migration #161 is applied. The table is not in
 * lib/db/types.ts until then, hence the structural cast.
 */
async function expiryHistoryByDocument(
  tenantId: string,
  fileId: string,
): Promise<Map<string, ReturnType<typeof summarizeExpiryHistory>>> {
  const out = new Map<string, ReturnType<typeof summarizeExpiryHistory>>();
  if (!(await expiryGovernanceAvailable())) return out;
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("document_expiry_change" as never)
    .select("id, document_id, kind, proposal_id, old_expiry, new_expiry, reason, actor_id, occurred_at, actor:actor_id(email)")
    .eq("tenant_id" as never, tenantId as never)
    .eq("file_id" as never, fileId as never)
    .order("occurred_at" as never, { ascending: false })
    .limit(500);
  if (error) throw new Error(`[documents] expiry history failed: ${error.message}`);
  const byDoc = new Map<string, (ExpiryHistoryEntry & { proposalId: string | null })[]>();
  for (const r of (data ?? []) as unknown as ExpiryRow[]) {
    const list = byDoc.get(r.document_id) ?? [];
    list.push({
      id: r.id,
      kind: r.kind,
      proposalId: r.proposal_id,
      oldExpiry: r.old_expiry,
      newExpiry: r.new_expiry,
      reason: r.reason,
      actorId: r.actor_id,
      actorEmail: r.actor?.email ?? null,
      occurredAt: r.occurred_at,
    });
    byDoc.set(r.document_id, list);
  }
  for (const [docId, rows] of byDoc) out.set(docId, summarizeExpiryHistory(rows));
  return out;
}

type DocRow = {
  id: string;
  file_id: string;
  type_code: string;
  title: string | null;
  status: string;
  version: number;
  expiry_date: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  review_note: string | null;
  shared_with_client: boolean;
  created_at: string;
  doc_type: { label_fr: string } | null;
  uploader: { email: string | null } | null;
  reviewer: { email: string | null } | null;
};

const SELECT =
  "id, file_id, type_code, title, status, version, expiry_date, mime_type, size_bytes, review_note, shared_with_client, created_at, doc_type:type_code(label_fr), uploader:uploaded_by(email), reviewer:reviewed_by(email)";

/** The active document-type catalog (reference data; ordered for display). */
export async function listDocumentTypes(): Promise<DocumentTypeItem[]> {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("document_type")
    .select("code, label_fr, category, has_validity, required_for, conditional")
    .eq("active", true)
    .order("sort_order");
  if (error) throw new Error(`[documents] catalog failed: ${error.message}`);
  // WES-4G.7 — generated artifacts leave the UPLOAD catalogue. They remain real
  // document types (existing rows keep resolving); they are simply no longer
  // offered as something to attach, because the platform authors them.
  return (data ?? []).filter((t) => !isGeneratableArtifact(t.code)).map((t) => ({
    code: t.code,
    labelFr: t.label_fr,
    category: t.category,
    hasValidity: t.has_validity,
    requiredFor: t.required_for ?? [],
    conditional: t.conditional,
  }));
}

/** Non-deleted documents on a dossier the caller may read. */
export async function listDocuments(fileId: string): Promise<DocumentItem[]> {
  const user = await assertPermission("document:read");
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return [];

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("document")
    .select(SELECT)
    .eq("tenant_id", user.tenantId)
    .eq("file_id", fileId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<DocRow[]>();
  if (error) throw new Error(`[documents] list failed: ${error.message}`);

  const expiry = await expiryHistoryByDocument(user.tenantId, fileId);

  const now = new Date();
  return (data ?? []).map((d) => ({
    id: d.id,
    fileId: d.file_id,
    typeCode: d.type_code,
    typeLabel: d.doc_type?.label_fr ?? d.type_code,
    title: d.title,
    status: d.status as DocumentStatus,
    version: d.version,
    expiryDate: d.expiry_date,
    expiryState: classifyExpiry(d.expiry_date, now),
    mimeType: d.mime_type,
    sizeBytes: d.size_bytes,
    uploadedByEmail: d.uploader?.email ?? null,
    reviewedByEmail: d.reviewer?.email ?? null,
    reviewNote: d.review_note,
    sharedWithClient: d.shared_with_client,
    createdAt: d.created_at,
    expiryHistory: expiry.get(d.id)?.recent ?? [],
    pendingExpiryProposal: expiry.get(d.id)?.pending ?? null,
  }));
}

/**
 * Required document types for a dossier type that have no APPROVED instance yet
 * (drives the "missing documents" indicator). Derived; warn-only (DEC-B21 D3).
 */
export async function getMissingRequiredDocuments(
  fileId: string,
  fileType: string,
): Promise<MissingDocument[]> {
  const user = await assertPermission("document:read");
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return [];

  const supabase = getAdminSupabaseClient();
  const [types, docs] = await Promise.all([
    supabase
      .from("document_type")
      .select("code, label_fr, required_for")
      .eq("active", true)
      .contains("required_for", [fileType]),
    supabase
      .from("document")
      .select("type_code, status")
      .eq("tenant_id", user.tenantId)
      .eq("file_id", fileId)
      .is("deleted_at", null),
  ]);

  // WES-5C — STAGE-AWARE. The old computation counted every required_for type
  // as missing regardless of stage, so a POD (transport stage) blocked the
  // Documentation department from day one. One canonical resolver now answers.
  const labelByCode = new Map((types.data ?? []).map((t) => [t.code as string, t.label_fr as string]));
  const missing = missingDocumentationEvidence({
    fileType,
    requiredCodes: (types.data ?? []).map((t) => t.code as string),
    facts: (docs.data ?? []).map((d) => ({ typeCode: d.type_code as string, status: d.status as string })),
  });
  return missing.map((m) => ({ code: m.code, label: labelByCode.get(m.code) ?? m.label }));
}


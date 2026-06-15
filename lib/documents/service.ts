/**
 * Document reads (Phase 1.8). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Service-role admin client (privileged read, gated by assertPermission +
 * dossier visibility) — documents embed type label + uploader/reviewer email,
 * which carry their own RLS a user-context embed can't satisfy. The document
 * RLS SELECT policy (tenant + document:read + can_read_file + not deleted) is
 * the CI-tested boundary. Soft-deleted rows are excluded.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { classifyExpiry } from "./expiry";
import type { DocumentItem, DocumentStatus, DocumentTypeItem, MissingDocument } from "./types";

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
  return (data ?? []).map((t) => ({
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

  const approved = new Set(
    (docs.data ?? []).filter((d) => d.status === "APPROVED").map((d) => d.type_code),
  );
  return (types.data ?? [])
    .filter((t) => !approved.has(t.code))
    .map((t) => ({ code: t.code, label: t.label_fr }));
}

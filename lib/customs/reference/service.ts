/**
 * Customs Reference Library — reads. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * CUSTOMS-REF-01A / REF-1. Service-role admin client gated by
 * assertPermission('customs:reference:read'), exactly as lib/customs/service.ts
 * does for dossier customs reads. The RLS policy on
 * `customs_reference_document` (tenant + the two permissions + PUBLISHED-only
 * for a plain reader) is the independently CI-tested boundary; neither layer
 * trusts the other to have done it.
 *
 * NO DOSSIER VISIBILITY CHECK, and that is correct rather than an omission.
 * Dossier reads call isFileVisible because a document belongs to a dossier
 * somebody may not be assigned to. A reference document belongs to no dossier:
 * it is the Customs Code. Scoping it to dossier assignment would be inventing a
 * relationship that does not exist — and the library has to stay readable when
 * a dossier is closed, archived, or never existed.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import type {
  LicenceStatus,
  ReferenceCategory,
  ReferenceDocument,
  ReferenceStatus,
} from "./types";

const COLUMNS =
  "id, category, title, source_authority, edition, published_on, reference_code, version, "
  + "supersedes_id, superseded_by_id, superseded_at, size_bytes, content_sha256, status, "
  + "licence_status, redistribution_allowed, licence_note, provenance_verified, "
  + "legal_version_verified, uploaded_by, uploaded_at, published_by, published_at, "
  + "withdrawn_at, notes";

type Row = {
  id: string;
  category: string;
  title: string;
  source_authority: string;
  edition: string | null;
  published_on: string | null;
  reference_code: string | null;
  version: number;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  superseded_at: string | null;
  size_bytes: number;
  content_sha256: string;
  status: string;
  licence_status: string;
  redistribution_allowed: boolean;
  licence_note: string | null;
  provenance_verified: boolean;
  legal_version_verified: boolean;
  uploaded_by: string;
  uploaded_at: string;
  published_by: string | null;
  published_at: string | null;
  withdrawn_at: string | null;
  notes: string | null;
};

function toDocument(r: Row): ReferenceDocument {
  return {
    id: r.id,
    category: r.category as ReferenceCategory,
    title: r.title,
    sourceAuthority: r.source_authority,
    edition: r.edition,
    publishedOn: r.published_on,
    referenceCode: r.reference_code,
    version: r.version,
    supersedesId: r.supersedes_id,
    supersededById: r.superseded_by_id,
    supersededAt: r.superseded_at,
    sizeBytes: Number(r.size_bytes),
    contentSha256: r.content_sha256,
    status: r.status as ReferenceStatus,
    licenceStatus: r.licence_status as LicenceStatus,
    redistributionAllowed: r.redistribution_allowed,
    licenceNote: r.licence_note,
    provenanceVerified: r.provenance_verified,
    legalVersionVerified: r.legal_version_verified,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    publishedBy: r.published_by,
    publishedAt: r.published_at,
    withdrawnAt: r.withdrawn_at,
    notes: r.notes,
  };
}

export type LibraryView = {
  documents: ReferenceDocument[];
  /** Whether this viewer may upload, publish, replace and withdraw. */
  canPublish: boolean;
};

/**
 * The library as this viewer may see it.
 *
 * A plain reader gets PUBLISHED documents only — the status filter is applied
 * HERE as well as in the policy, because this read runs as the service role and
 * the policy therefore does not constrain it. That is the whole reason the
 * filter is not left to RLS: a service-role read bypasses the policy, so the
 * application must re-state the rule rather than inherit it.
 */
export async function getLibrary(filter?: {
  category?: ReferenceCategory;
}): Promise<LibraryView> {
  const user = await assertPermission("customs:reference:read");
  const permissions = await getEffectivePermissions(user.id);
  const canPublish = hasPermission(permissions, "customs:reference:publish");

  const supabase = getAdminSupabaseClient();
  let query = supabase
    .from("customs_reference_document")
    .select(COLUMNS)
    .eq("tenant_id", user.tenantId);

  // The visibility rule, restated for the service-role client.
  if (!canPublish) query = query.eq("status", "PUBLISHED");
  if (filter?.category) query = query.eq("category", filter.category);

  const { data } = await query
    .order("category", { ascending: true })
    .order("published_on", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false })
    .returns<Row[]>();

  return { documents: (data ?? []).map(toDocument), canPublish };
}

/**
 * One document, or null.
 *
 * Returns null rather than throwing for a document in another tenant, for one
 * that does not exist, and for a quarantined document a plain reader asked
 * for: all three are indistinguishable to the caller, so none of them leaks
 * the existence of a row.
 */
export async function getReferenceDocument(id: string): Promise<ReferenceDocument | null> {
  const user = await assertPermission("customs:reference:read");
  const permissions = await getEffectivePermissions(user.id);
  const canPublish = hasPermission(permissions, "customs:reference:publish");

  const supabase = getAdminSupabaseClient();
  const { data } = await supabase
    .from("customs_reference_document")
    .select(COLUMNS)
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<Row>();
  if (!data) return null;
  if (!canPublish && data.status !== "PUBLISHED") return null;
  return toDocument(data);
}

/** Every version sharing a business key, newest first. The history view. */
export async function getVersionHistory(
  referenceCode: string,
  category: ReferenceCategory,
): Promise<ReferenceDocument[]> {
  const user = await assertPermission("customs:reference:read");
  const permissions = await getEffectivePermissions(user.id);
  const canPublish = hasPermission(permissions, "customs:reference:publish");

  const supabase = getAdminSupabaseClient();
  let query = supabase
    .from("customs_reference_document")
    .select(COLUMNS)
    .eq("tenant_id", user.tenantId)
    .eq("reference_code", referenceCode)
    .eq("category", category);
  if (!canPublish) query = query.eq("status", "PUBLISHED");

  const { data } = await query.order("version", { ascending: false }).returns<Row[]>();
  return (data ?? []).map(toDocument);
}

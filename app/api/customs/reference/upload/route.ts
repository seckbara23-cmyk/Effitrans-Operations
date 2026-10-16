/**
 * Customs Reference Library — upload. CUSTOMS-REF-01A / REF-1.
 * ---------------------------------------------------------------------------
 * A ROUTE HANDLER, not a server action, and the reason is the body limit: a
 * Next.js server action caps its payload at 1 MB by default, which most
 * statutory PDFs exceed. A route handler is bounded instead by the hosting
 * platform's request limit (4.5 MB on Vercel), which is what
 * `MAX_UPLOAD_BYTES` states. Raising the ceiling further is not a constant
 * change — it needs a server-minted signed upload URL so the bytes go straight
 * to storage — and that is deliberately out of REF-1.
 *
 * SECURITY, in the order it is enforced:
 *   1. a STAFF session is required — a portal user is refused outright, since
 *      `getCurrentPortalUser` is never consulted here and there is no branch
 *      that could accept one;
 *   2. `customs:reference:publish` is required — reading the library is not
 *      authority to add to it;
 *   3. the bytes are validated for real: declared MIME, then the PDF magic
 *      number, then size bounds, then declared-vs-actual size;
 *   4. the object key is derived from the tenant and a server-generated uuid,
 *      never from the uploaded filename;
 *   5. the row lands QUARANTINE, unverified and licence-RESTRICTED, so a
 *      successful upload grants no consultability to anybody.
 *
 * THERE IS NO MALWARE SCANNER IN THIS PLATFORM. That is why step 5 exists and
 * why this route cannot publish. It is reported as an open gate, not treated as
 * covered.
 */
import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { isReferenceCategory } from "@/lib/customs/reference/types";
import {
  ACCEPTED_MIME,
  buildReferencePath,
  validateUpload,
} from "@/lib/customs/reference/validate";

export const dynamic = "force-dynamic";

const BUCKET = "customs-reference";

const str = (f: FormDataEntryValue | null): string => (typeof f === "string" ? f : "");
const nullable = (f: FormDataEntryValue | null): string | null => {
  const v = str(f).trim();
  return v.length > 0 ? v : null;
};

export async function POST(request: Request) {
  // ---- who is asking -------------------------------------------------------
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "customs:reference:publish")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "invalid_input" }, { status: 400 }); }

  const category = str(form.get("category"));
  const title = str(form.get("title"));
  const sourceAuthority = str(form.get("sourceAuthority"));
  const edition = nullable(form.get("edition"));
  const publishedOn = nullable(form.get("publishedOn"));
  const referenceCode = nullable(form.get("referenceCode"));
  const supersedesId = nullable(form.get("supersedesId"));
  const notes = nullable(form.get("notes"));
  const file = form.get("file");

  const upload = file instanceof File ? file : null;
  const bytes = upload ? new Uint8Array(await upload.arrayBuffer()) : null;

  const verdict = validateUpload({
    bytes,
    declaredMime: upload?.type ?? null,
    declaredSize: upload?.size ?? null,
    title,
    sourceAuthority,
    categoryValid: isReferenceCategory(category),
    publishedOn,
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });
  // Narrowed by the validator, restated for the type system.
  if (!bytes) return NextResponse.json({ error: "missing_file" }, { status: 400 });

  const supabase = getAdminSupabaseClient();

  // ---- replacement: the predecessor must be ours ---------------------------
  // Its version is read HERE rather than trusted from the form, and the tenant
  // filter is what stops a replacement being chained onto another tenant's row.
  let version = 1;
  if (supersedesId) {
    const { data: prior } = await supabase
      .from("customs_reference_document")
      .select("id, version, category, superseded_by_id")
      .eq("id", supersedesId)
      .eq("tenant_id", user.tenantId)
      .maybeSingle<{ id: string; version: number; category: string; superseded_by_id: string | null }>();
    if (!prior) return NextResponse.json({ error: "predecessor_not_found" }, { status: 404 });
    if (prior.superseded_by_id) {
      return NextResponse.json({ error: "predecessor_already_superseded" }, { status: 409 });
    }
    // A tariff edition does not replace a circular.
    if (prior.category !== category) {
      return NextResponse.json({ error: "category_mismatch" }, { status: 409 });
    }
    version = prior.version + 1;
  }

  // ---- the bytes -----------------------------------------------------------
  // The id is generated first so the object key and the row key are the same
  // value, and the hash is taken from the SAME buffer that is uploaded, so the
  // recorded checksum necessarily describes what is stored.
  const documentId = randomUUID();
  const path = buildReferencePath(user.tenantId, documentId);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: ACCEPTED_MIME, upsert: false });
  if (upErr) return NextResponse.json({ error: "upload_failed" }, { status: 503 });

  const { data: row, error: insErr } = await supabase
    .from("customs_reference_document")
    .insert({
      id: documentId,
      tenant_id: user.tenantId,
      category,
      title: title.trim(),
      source_authority: sourceAuthority.trim(),
      edition,
      published_on: publishedOn,
      reference_code: referenceCode,
      version,
      supersedes_id: supersedesId,
      storage_path: path,
      mime_type: ACCEPTED_MIME,
      size_bytes: bytes.length,
      content_sha256: sha256,
      uploaded_by: user.id,
      notes,
      // status, licence_status, redistribution_allowed, provenance_verified and
      // legal_version_verified are all left to their SAFE database defaults.
      // Passing them here would make this route the place somebody could later
      // weaken them without touching a migration.
    })
    .select("id")
    .single();

  // The object must not outlive a failed insert: an orphaned blob is a file
  // nobody can see, delete or account for.
  if (insErr || !row) {
    await supabase.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  await writeAudit({
    action: supersedesId
      ? AuditActions.CUSTOMS_REFERENCE_REPLACED
      : AuditActions.CUSTOMS_REFERENCE_UPLOADED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_reference_document",
    entityId: documentId,
    after: {
      category,
      title: title.trim(),
      source_authority: sourceAuthority.trim(),
      version,
      supersedes_id: supersedesId,
      size_bytes: bytes.length,
      sha256,
      status: "QUARANTINE",
    },
  });

  // 201 with the quarantine state said out loud: the caller must not read this
  // as "the document is now available".
  return NextResponse.json({ ok: true, id: documentId, status: "QUARANTINE" }, { status: 201 });
}

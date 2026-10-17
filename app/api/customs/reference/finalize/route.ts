/**
 * Customs Reference Library — finalise a direct-to-storage upload.
 * CUSTOMS-REF-01A / REF-2, step 2 of 2.
 * ---------------------------------------------------------------------------
 * THIS ROUTE IS THE BOUNDARY. `/upload-url` authorised a transfer; it decided
 * nothing. The bytes it let through are sitting in a `_staging/` prefix having
 * been inspected by nobody, and this route is the only thing that can turn
 * them into a document. It therefore re-checks everything from scratch and
 * trusts nothing from the ticket except the tenant on the current session.
 *
 * WHY THE BYTES ARE READ BACK AND RE-UPLOADED RATHER THAN MOVED. `content_sha256`
 * must describe what is ACTUALLY stored — migration 152 says so, and the whole
 * malware gate is bound to that hash: `record_customs_reference_scan` refuses a
 * verdict that does not match the document's current bytes. A `move` would
 * record a hash taken from bytes read a moment earlier and leave a window in
 * which the signed upload URL could be used again to replace them. So the
 * verified buffer itself is written to the final path by the service role,
 * exactly as the REF-1 route does, and the hash necessarily describes it.
 *
 * SECURITY, in the order it is enforced:
 *   1. a STAFF session is required — `getCurrentPortalUser` is never consulted;
 *   2. `customs:reference:publish` is required;
 *   3. `uploadId` must be a uuid. This is NOT cosmetic: the staging key is
 *      built from it, and a value carrying `..` or a separator is how an
 *      upload escapes its prefix. The shape is asserted before it reaches a
 *      path;
 *   4. the object's size is read from storage metadata BEFORE it is downloaded,
 *      so an oversized object is refused rather than pulled into memory;
 *   5. the bytes are validated for real — declared MIME, the PDF magic number,
 *      size bounds against the BUCKET's limit, declared-vs-actual size, and the
 *      declared hash when one was given;
 *   6. the final object key is derived from the tenant and a server-generated
 *      document uuid, never from a filename or from the staging key;
 *   7. the row lands QUARANTINE, unverified and licence-RESTRICTED. The INSERT
 *      names none of those columns, so the database defaults remain the only
 *      place they are decided.
 *
 * THERE IS STILL NO MALWARE SCANNER. A 50 MB PDF is no safer than a 4 MB one,
 * and nothing here pretends otherwise: a finalised upload is quarantined and
 * unpublishable until a scanner records a CLEAN verdict bound to these exact
 * bytes. REF-2 raised the size ceiling; it did not touch the gate.
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
  MAX_DIRECT_UPLOAD_BYTES,
  buildReferencePath,
  buildStagingPath,
  normalizeRegimes,
  parseRegimeInput,
  validateUpload,
} from "@/lib/customs/reference/validate";

export const dynamic = "force-dynamic";

const BUCKET = "customs-reference";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  // ---- who is asking -------------------------------------------------------
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "customs:reference:publish")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_input" }, { status: 400 }); }

  const str = (k: string): string => (typeof body[k] === "string" ? (body[k] as string) : "");
  const nullable = (k: string): string | null => {
    const v = str(k).trim();
    return v.length > 0 ? v : null;
  };

  // ---- the ticket's only trusted part -------------------------------------
  const uploadId = str("uploadId").trim();
  if (!UUID.test(uploadId)) {
    return NextResponse.json({ error: "invalid_upload_id" }, { status: 400 });
  }

  const category = str("category");
  const title = str("title");
  const sourceAuthority = str("sourceAuthority");
  const edition = nullable("edition");
  const publishedOn = nullable("publishedOn");
  const referenceCode = nullable("referenceCode");
  const supersedesId = nullable("supersedesId");
  const notes = nullable("notes");
  const declaredSha256 = (nullable("sha256") ?? "").toLowerCase() || null;
  const declaredSize = Number.isInteger(Number(body.declaredSize))
    ? Number(body.declaredSize)
    : null;

  const regimes = normalizeRegimes(parseRegimeInput(nullable("customsRegimes")));
  if (!regimes.ok) return NextResponse.json({ error: regimes.error }, { status: 400 });

  const supabase = getAdminSupabaseClient();
  // Built from the SESSION's tenant and the validated uuid. The caller cannot
  // name a path, and cannot name another tenant's.
  const stagingPath = buildStagingPath(user.tenantId, uploadId);

  /** Staged bytes must never outlive a refusal: they are unvalidated. */
  const dropStaging = async () => {
    await supabase.storage.from(BUCKET).remove([stagingPath]).catch(() => {});
  };

  // ---- size from metadata, before anything is pulled into memory ----------
  const { data: listed } = await supabase.storage
    .from(BUCKET)
    .list(`${user.tenantId}/_staging`, { search: `${uploadId}.pdf`, limit: 1 });

  const staged = (listed ?? []).find((o) => o.name === `${uploadId}.pdf`);
  if (!staged) return NextResponse.json({ error: "upload_not_found" }, { status: 404 });

  const storedSize = Number(
    (staged.metadata as { size?: number } | null)?.size ?? Number.NaN,
  );
  if (Number.isFinite(storedSize) && storedSize > MAX_DIRECT_UPLOAD_BYTES) {
    await dropStaging();
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }

  // ---- the bytes -----------------------------------------------------------
  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(stagingPath);
  if (dlErr || !blob) {
    await dropStaging();
    return NextResponse.json({ error: "upload_not_found" }, { status: 404 });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());

  const verdict = validateUpload({
    bytes,
    // The staging object was written with this content type by the signed
    // upload; what decides is the magic number on the next line of the
    // validator, exactly as in the REF-1 path.
    declaredMime: ACCEPTED_MIME,
    declaredSize,
    title,
    sourceAuthority,
    referenceCode,
    categoryValid: isReferenceCategory(category),
    publishedOn,
    maxBytes: MAX_DIRECT_UPLOAD_BYTES,
  });
  if (!verdict.ok) {
    await dropStaging();
    return NextResponse.json({ error: verdict.error }, { status: 400 });
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // When the browser computed a hash, it must agree. A mismatch means the bytes
  // that arrived are not the bytes the operator chose — a truncated transfer or
  // a substitution — and the only honest answer is to refuse both.
  if (declaredSha256 && declaredSha256 !== sha256) {
    await dropStaging();
    return NextResponse.json({ error: "sha256_mismatch" }, { status: 400 });
  }

  // ---- replacement: the predecessor must be ours ---------------------------
  // Re-resolved here rather than carried from the ticket: between minting and
  // finalising, the predecessor may have been superseded by somebody else.
  let version = 1;
  let effectiveCode = (referenceCode ?? "").trim();
  if (supersedesId) {
    const { data: prior } = await supabase
      .from("customs_reference_document")
      .select("id, version, category, reference_code, superseded_by_id")
      .eq("id", supersedesId)
      .eq("tenant_id", user.tenantId)
      .maybeSingle<{
        id: string; version: number; category: string;
        reference_code: string; superseded_by_id: string | null;
      }>();
    if (!prior) {
      await dropStaging();
      return NextResponse.json({ error: "predecessor_not_found" }, { status: 404 });
    }
    if (prior.superseded_by_id) {
      await dropStaging();
      return NextResponse.json({ error: "predecessor_already_superseded" }, { status: 409 });
    }
    if (prior.category !== category) {
      await dropStaging();
      return NextResponse.json({ error: "category_mismatch" }, { status: 409 });
    }
    if (effectiveCode !== prior.reference_code) {
      await dropStaging();
      return NextResponse.json({ error: "reference_code_mismatch" }, { status: 409 });
    }
    effectiveCode = prior.reference_code;
    version = prior.version + 1;
  }

  // ---- the document --------------------------------------------------------
  const documentId = randomUUID();
  const path = buildReferencePath(user.tenantId, documentId);

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: ACCEPTED_MIME, upsert: false });
  if (upErr) {
    await dropStaging();
    return NextResponse.json({ error: "upload_failed" }, { status: 503 });
  }

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
      reference_code: effectiveCode,
      customs_regimes: regimes.regimes,
      version,
      supersedes_id: supersedesId,
      storage_path: path,
      mime_type: ACCEPTED_MIME,
      size_bytes: bytes.length,
      content_sha256: sha256,
      uploaded_by: user.id,
      notes,
      // status, licence_status, redistribution_allowed, provenance_verified and
      // legal_version_verified are left to their SAFE database defaults, for
      // the same reason the REF-1 route leaves them: naming them here would
      // make this route the place somebody could later publish on upload
      // without touching a migration.
    })
    .select("id")
    .single();

  if (insErr || !row) {
    await supabase.storage.from(BUCKET).remove([path]);
    await dropStaging();
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // REF-1-HARDEN (F3) — COMPENSATE A FAILED AUDIT. `writeAudit` throws when the
  // event cannot be written (WES-9), and a document with no record of who put
  // it there is precisely what the audit trail exists to make impossible. Row
  // first, then the object: a row with no object is a broken link an operator
  // can see; an object with no row is a file nobody can account for.
  try {
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
        reference_code: effectiveCode,
        customs_regimes: regimes.regimes,
        version,
        supersedes_id: supersedesId,
        size_bytes: bytes.length,
        sha256,
        status: "QUARANTINE",
        via: "direct_upload",
      },
    });
  } catch {
    await supabase
      .from("customs_reference_document")
      .delete()
      .eq("id", documentId)
      .eq("tenant_id", user.tenantId);
    await supabase.storage.from(BUCKET).remove([path]);
    await dropStaging();
    return NextResponse.json({ error: "audit_failed" }, { status: 500 });
  }

  // The staging copy has served its purpose. Its removal is deliberately the
  // LAST thing and deliberately not fatal: the document is complete and
  // audited, and a leftover staging object is an orphan to sweep, not a reason
  // to fail a finished upload.
  await dropStaging();

  return NextResponse.json(
    { ok: true, id: documentId, status: "QUARANTINE", sha256, sizeBytes: bytes.length },
    { status: 201 },
  );
}

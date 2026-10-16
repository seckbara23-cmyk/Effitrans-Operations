/**
 * Customs Reference Library — the viewer. CUSTOMS-REF-01A / REF-1.
 * ---------------------------------------------------------------------------
 * THE ONE DOOR to a reference document's bytes.
 *
 * THE BYTES ARE STREAMED; NO SIGNED URL IS ISSUED. This follows the invoice PDF
 * route rather than the HR/expense pattern, and the difference matters here
 * more than it does there. A signed URL is a bearer token in a string: once
 * minted it authorises anyone holding it for its whole lifetime, it survives
 * being pasted into a chat, and it is logged by every proxy in between. Some of
 * this library's material is licence-restricted — the WCO Explanatory Notes are
 * copyrighted and their terms are not yet known — so a shareable link is
 * precisely the wrong primitive: redistribution is the thing the licence gate
 * exists to prevent. Streaming keeps authorization per-request, and the bucket
 * stays deny-by-default with no storage.objects policy naming it at all.
 *
 * SECURITY, in the order it is enforced:
 *   1. a STAFF session is required. `getCurrentPortalUser` is deliberately not
 *      consulted: there is no customer-facing branch, so a portal account
 *      cannot reach a byte of this library;
 *   2. `customs:reference:read` is required;
 *   3. the row is loaded WITH AN EXPLICIT TENANT FILTER, so an id from another
 *      tenant is simply not found;
 *   4. a plain reader may fetch PUBLISHED documents only. QUARANTINE and
 *      WITHDRAWN are visible to a holder of `customs:reference:publish`, who
 *      has to be able to open a quarantined upload in order to judge it;
 *   5. the access is audited, because a licence obligation cannot be evidenced
 *      without a record of who consulted what.
 *
 * A 404 — not a 403 — is returned for a document the caller may not see, so the
 * response never discloses that a row exists.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { referenceFileName } from "@/lib/customs/reference/validate";

export const dynamic = "force-dynamic";

const BUCKET = "customs-reference";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "customs:reference:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const canPublish = hasPermission(permissions, "customs:reference:publish");

  const supabase = getAdminSupabaseClient();
  const { data: doc } = await supabase
    .from("customs_reference_document")
    .select("id, title, version, status, category, storage_path, content_sha256, licence_status")
    .eq("id", params.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{
      id: string; title: string; version: number; status: string; category: string;
      storage_path: string; content_sha256: string; licence_status: string;
    }>();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Not published, and the caller is not a publisher: indistinguishable from
  // absent.
  if (doc.status !== "PUBLISHED" && !canPublish) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: blob, error } = await supabase.storage.from(BUCKET).download(doc.storage_path);
  if (error || !blob) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const bytes = new Uint8Array(await blob.arrayBuffer());

  await writeAudit({
    action: AuditActions.CUSTOMS_REFERENCE_ACCESSED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_reference_document",
    entityId: doc.id,
    after: {
      category: doc.category,
      status: doc.status,
      licence_status: doc.licence_status,
      version: doc.version,
    },
  });

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${referenceFileName(doc.title, doc.version)}"`,
      "Content-Length": String(bytes.byteLength),
      // The bytes are immutable; the AUTHORIZATION is per-request. Never let a
      // shared cache serve this to the next caller.
      "Cache-Control": "private, no-store",
      "X-Reference-Sha256": doc.content_sha256,
    },
  });
}

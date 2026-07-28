/**
 * Official invoice PDF download (UAT-2B). Protected, tenant-scoped.
 * ---------------------------------------------------------------------------
 * The ONE way anyone obtains an official invoice PDF — Finance, the customer
 * portal, and any future audit export all come through here.
 *
 * SECURITY, in the order it is enforced:
 *   1. a session is required (staff OR portal user) — anonymous gets 401;
 *   2. the invoice is loaded WITH AN EXPLICIT TENANT FILTER, so an id from
 *      another tenant is simply not found (no direct-object reference);
 *   3. staff need `finance:read`; a portal user must be attached to the
 *      invoice's own client, so one customer cannot read another's invoice;
 *   4. the bytes are STREAMED from the private bucket by the service role.
 *      No signed URL is handed to the browser and the bucket stays
 *      deny-by-default, so there is no permanent unauthenticated link and
 *      nothing to leak by sharing a URL.
 *
 * Availability is deliberately broad: an issued invoice remains downloadable
 * after payment, verification, cancellation, closure and archival. An
 * accounting document that disappears when the dossier is archived is useless
 * precisely when an auditor asks for it. Only a DRAFT has nothing to return —
 * it has no official number and is not an accounting document.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCurrentPortalUser } from "@/lib/portal/auth";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { DOCUMENTS_BUCKET } from "@/lib/documents/storage";
import { ensureOfficialInvoiceArtifact, invoiceFileName } from "@/lib/finance/invoice-artifact";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const invoiceId = params.id;

  // ---- who is asking -------------------------------------------------------
  const staff = await getCurrentUser();
  const portal = staff ? null : await getCurrentPortalUser();
  if (!staff && !portal) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const tenantId = staff?.tenantId ?? portal?.tenantId;
  if (!tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = getAdminSupabaseClient();

  // ---- the invoice, TENANT-SCOPED -----------------------------------------
  const { data: invoice } = await supabase
    .from("invoice")
    .select("id, tenant_id, client_id, status, invoice_number")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string; tenant_id: string; client_id: string | null;
      status: string; invoice_number: string | null;
    }>();
  // Uniform 404: an invoice in another tenant and one that does not exist are
  // indistinguishable to the caller.
  if (!invoice) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // ---- authorization -------------------------------------------------------
  if (staff) {
    const permissions = await getEffectivePermissions(staff.id);
    if (!hasPermission(permissions, "finance:read")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (portal) {
    // A customer may read only their OWN client's invoices.
    if (!invoice.client_id || invoice.client_id !== portal.clientId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  }

  // A draft has no accounting document.
  if (invoice.status === "DRAFT" || !invoice.invoice_number) {
    return NextResponse.json({ error: "not_issued" }, { status: 409 });
  }

  // ---- the artifact (generated once; this call is idempotent) -------------
  const artifact = await ensureOfficialInvoiceArtifact({
    supabase,
    tenantId,
    invoiceId,
    actorId: staff?.id ?? null,
  });
  if (!artifact) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { data: blob, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(artifact.storagePath);
  if (error || !blob) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const filename = invoiceFileName(artifact.invoiceNumber || invoice.invoice_number);

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      // The bytes are immutable, but the AUTHORIZATION is per-request: never
      // let a shared cache serve this to someone else.
      "Cache-Control": "private, no-store",
      "X-Invoice-Sha256": artifact.contentSha256,
    },
  });
}

/**
 * Official invoice artifact (UAT-2B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The allocate-once pipeline that turns an issued invoice into an immutable
 * accounting document:
 *
 *   number allocated → snapshot frozen → PDF rendered → SHA-256 computed
 *   → stored in the private bucket → artifact finalized → NEVER regenerated
 *
 * "Never regenerated" is enforced in three independent places, because a single
 * guard is not enough for a document that tax authorities may read:
 *   1. this function returns early when an artifact already exists;
 *   2. `finalize_official_invoice` returns the existing row instead of
 *      inserting (idempotent under concurrency);
 *   3. `uq_document_official_invoice` makes a second row impossible, and
 *      `protect_official_invoice_artifact` refuses any UPDATE or DELETE.
 *
 * Failure here does NOT roll back issuance. The invoice number is allocated and
 * the invoice is legally issued the moment the row says ISSUED; a rendering
 * failure must not undo that. The artifact is produced on the next attempt —
 * `ensureOfficialInvoiceArtifact` is safe to call repeatedly and is invoked
 * from the download path too, so a missed generation self-heals rather than
 * leaving an invoice permanently without its PDF.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { uploadObject, sha256Hex } from "@/lib/documents/storage";
import { renderOfficialInvoice, INVOICE_RENDERER_VERSION, type InvoiceSnapshot } from "./invoice-pdf";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

export type InvoiceArtifact = {
  documentId: string;
  storagePath: string;
  contentSha256: string;
  invoiceNumber: string;
  /** True when it already existed — i.e. nothing was rendered. */
  already: boolean;
};

/** The canonical download filename: the official number, nothing else. */
export function invoiceFileName(invoiceNumber: string): string {
  return `${invoiceNumber}.pdf`;
}

/**
 * Return the invoice's official artifact, generating it exactly once.
 *
 * Returns null when the invoice is not issued (a DRAFT has no accounting
 * document by definition) or when the snapshot cannot be assembled.
 */
export async function ensureOfficialInvoiceArtifact(input: {
  supabase: Admin;
  tenantId: string;
  invoiceId: string;
  actorId: string | null;
}): Promise<InvoiceArtifact | null> {
  const { supabase, tenantId, invoiceId, actorId } = input;

  // ---- 1. already generated? ---------------------------------------------
  const { data: existing } = await supabase
    .from("document")
    .select("id, storage_path, content_sha256, title")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .eq("artifact_code", "OFFICIAL_INVOICE")
    .maybeSingle<{ id: string; storage_path: string; content_sha256: string; title: string | null }>();
  if (existing) {
    return {
      documentId: existing.id,
      storagePath: existing.storage_path,
      contentSha256: existing.content_sha256,
      invoiceNumber: existing.title ?? "",
      already: true,
    };
  }

  // ---- 2. the invoice must be ISSUED -------------------------------------
  const { data: invoice } = await supabase
    .from("invoice")
    .select("id, file_id, tenant_id, invoice_number, issue_date, due_date, currency, status, client_id")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string; file_id: string; tenant_id: string; invoice_number: string | null;
      issue_date: string | null; due_date: string | null; currency: string | null;
      status: string; client_id: string | null;
    }>();
  if (!invoice || !invoice.invoice_number || invoice.status === "DRAFT") return null;

  const snapshot = await buildInvoiceSnapshot(supabase, tenantId, invoice);
  if (!snapshot) return null;

  // ---- 3. render + hash ---------------------------------------------------
  const bytes = renderOfficialInvoice(snapshot);
  const contentSha256 = sha256Hex(bytes);
  const documentId = randomUUID();
  const storagePath = `${tenantId}/${invoice.file_id}/invoices/${invoice.invoice_number}-${documentId}.pdf`;

  await uploadObject(storagePath, bytes, "application/pdf");

  // ---- 4. finalize (idempotent in SQL) -----------------------------------
  const { data, error } = await supabase.rpc("finalize_official_invoice", {
    p_document_id: documentId,
    p_tenant_id: tenantId,
    p_file_id: invoice.file_id,
    p_invoice_id: invoice.id,
    p_invoice_number: invoice.invoice_number,
    p_storage_path: storagePath,
    p_content_sha256: contentSha256,
    // Frozen source, stored on the row for audit. Cast through JSON so the
    // stored snapshot is exactly what was rendered.
    p_source_snapshot: JSON.parse(JSON.stringify(snapshot)),
    p_renderer_version: INVOICE_RENDERER_VERSION,
    p_actor: actorId,
    p_size_bytes: bytes.byteLength,
  });
  if (error) return null;

  const result = data as { document_id: string; content_sha256: string; already: boolean } | null;
  if (!result) return null;

  return {
    documentId: result.document_id,
    storagePath,
    contentSha256: result.content_sha256,
    invoiceNumber: invoice.invoice_number,
    already: Boolean(result.already),
  };
}

/** Freeze everything the PDF may show. Nothing outside this is ever read. */
async function buildInvoiceSnapshot(
  supabase: Admin,
  tenantId: string,
  invoice: {
    id: string; file_id: string; invoice_number: string | null; issue_date: string | null;
    due_date: string | null; currency: string | null; client_id: string | null;
  },
): Promise<InvoiceSnapshot | null> {
  const [lines, file, org, client, shipment] = await Promise.all([
    supabase.from("invoice_line").select("description, quantity, unit_amount, tax_rate")
      .eq("invoice_id", invoice.id).eq("tenant_id", tenantId),
    supabase.from("operational_file").select("file_number, type, client_id")
      .eq("id", invoice.file_id).eq("tenant_id", tenantId)
      .maybeSingle<{ file_number: string; type: string; client_id: string | null }>(),
    supabase.from("organization").select("name, legal_name, currency").eq("id", tenantId)
      .maybeSingle<{ name: string; legal_name: string | null; currency: string | null }>(),
    invoice.client_id
      ? supabase.from("client").select("name, address").eq("id", invoice.client_id)
          .eq("tenant_id", tenantId).maybeSingle<{ name: string; address: string | null }>()
      : Promise.resolve({ data: null }),
    supabase.from("shipment")
      .select("transport_mode, origin, destination, bl_awb_ref, container_ref")
      .eq("file_id", invoice.file_id).eq("tenant_id", tenantId).limit(1)
      .maybeSingle<{
        transport_mode: string | null; origin: string | null; destination: string | null;
        bl_awb_ref: string | null; container_ref: string | null;
      }>(),
  ]);

  const fileRow = file.data ?? null;
  if (!fileRow || !invoice.invoice_number) return null;
  const lineRows = lines.data ?? [];
  if (lineRows.length === 0) return null;

  // Tenant identity, from the columns that ACTUALLY exist.
  //
  // The schema has NO structured address, tax-identifier or bank-detail fields.
  // Rather than invent them, the invoice uses the two free-text fields the
  // branding model already provides for exactly this — `pdf_header_text` and
  // `invoice_footer_text` — and omits anything unconfigured. A missing NINEA is
  // absent; it is never a placeholder.
  const brandingRes = await supabase
    .from("tenant_branding")
    .select("display_name, pdf_header_text, invoice_footer_text, support_email, support_phone")
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      display_name: string | null; pdf_header_text: string | null;
      invoice_footer_text: string | null; support_email: string | null; support_phone: string | null;
    }>();
  const branding = brandingRes.data ?? null;

  return {
    organizationName:
      org.data?.legal_name?.trim() || branding?.display_name?.trim() || org.data?.name || "—",
    organizationAddress: null,
    organizationPhone: branding?.support_phone ?? null,
    organizationEmail: branding?.support_email ?? null,
    // Legal/tax identifiers live in the configured header text, if configured.
    organizationIdentifiers: branding?.pdf_header_text ? [branding.pdf_header_text] : [],
    // Bank/payment details live in the configured invoice footer, if configured.
    paymentDetails: branding?.invoice_footer_text ? [branding.invoice_footer_text] : [],

    invoiceNumber: invoice.invoice_number,
    issueDate: invoice.issue_date ?? "",
    dueDate: invoice.due_date,
    currency: invoice.currency ?? org.data?.currency ?? "XOF",

    customerName: client.data?.name ?? "—",
    customerAddress: client.data?.address ?? null,
    fileNumber: fileRow.file_number,
    shipmentReference: null,
    blAwbReference: shipment.data?.bl_awb_ref ?? null,
    containerReference: shipment.data?.container_ref ?? null,
    transportMode: shipment.data?.transport_mode ?? null,
    origin: shipment.data?.origin ?? null,
    destination: shipment.data?.destination ?? null,

    lines: lineRows.map((l) => ({
      description: String(l.description),
      quantity: Number(l.quantity),
      unitAmount: Number(l.unit_amount),
      taxRate: Number(l.tax_rate),
    })),
  };
}

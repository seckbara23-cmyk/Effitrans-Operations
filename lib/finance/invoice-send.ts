"use server";
/**
 * Canonical invoice delivery (UAT-2B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * « Envoyer au client » — the ONE way an official invoice reaches a customer.
 *
 * It attaches the EXACT bytes already stored at issuance. It never renders,
 * never regenerates, and never mutates the artifact: it reads the finalized
 * object out of the private bucket and posts those same bytes. Finance's
 * download, the portal's download and this attachment therefore resolve to one
 * artifact with one SHA-256 — which is the whole point of storing the hash.
 *
 * RESEND IS UNLIMITED BY DESIGN. A customer who lost the email, a new accounts
 * contact, a bank asking for the invoice — all are ordinary and legitimate.
 * Every send is recorded separately, so "sent 3 times" is visible history
 * rather than a suspected duplicate. The artifact is identical every time.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { sendEmail, isProviderConfigured } from "@/lib/comms/provider";
import { DOCUMENTS_BUCKET } from "@/lib/documents/storage";
import { ensureOfficialInvoiceArtifact, invoiceFileName } from "./invoice-artifact";
import { invoiceTotals } from "./calc";

export type SendInvoiceResult =
  | { ok: true; sha256: string; resend: boolean }
  | { ok: false; error: string };

/**
 * Send (or resend) the official invoice to the customer.
 *
 * Requires `finance:issue` — delivering an accounting document to a customer is
 * an issuance-class act, not a read.
 */
export async function sendInvoiceToCustomer(invoiceId: string): Promise<SendInvoiceResult> {
  let user;
  try {
    user = await assertPermission("finance:issue");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();

  const { data: invoice } = await supabase
    .from("invoice")
    .select("id, file_id, client_id, status, invoice_number, issue_date, due_date, currency")
    .eq("id", invoiceId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{
      id: string; file_id: string; client_id: string | null; status: string;
      invoice_number: string | null; issue_date: string | null;
      due_date: string | null; currency: string | null;
    }>();
  if (!invoice) return { ok: false, error: "not_found" };
  if (invoice.status === "DRAFT" || !invoice.invoice_number) {
    return { ok: false, error: "not_issued" };
  }

  // Recipient, from the EXISTING contact model.
  const { data: client } = invoice.client_id
    ? await supabase.from("client").select("name, email").eq("id", invoice.client_id)
        .eq("tenant_id", user.tenantId).maybeSingle<{ name: string; email: string | null }>()
    : { data: null };
  const to = client?.email?.trim();
  if (!to) return { ok: false, error: "no_recipient" };

  if (!isProviderConfigured()) return { ok: false, error: "email_not_configured" };

  // ---- the finalized artifact — resolved, never regenerated ---------------
  const artifact = await ensureOfficialInvoiceArtifact({
    supabase,
    tenantId: user.tenantId,
    invoiceId,
    actorId: user.id,
  });
  if (!artifact) return { ok: false, error: "artifact_unavailable" };

  const { data: blob, error: dlErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(artifact.storagePath);
  if (dlErr || !blob) return { ok: false, error: "artifact_unavailable" };
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // ---- totals from the SAME function Finance and the PDF use -------------
  const { data: lineRows } = await supabase
    .from("invoice_line")
    .select("quantity, unit_amount, tax_rate")
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", user.tenantId);
  const { total } = invoiceTotals(
    (lineRows ?? []).map((l) => ({
      quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate),
    })),
  );
  const currency = invoice.currency ?? "XOF";
  const amount = `${total.toLocaleString("fr-FR").replace(/ | /g, " ")} ${currency}`;

  // Has it gone before? Only affects wording — never whether it may be sent.
  const { count: priorSends } = await supabase
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("entity", "invoice")
    .eq("entity_id", invoiceId)
    .eq("action", AuditActions.INVOICE_SENT);
  const resend = (priorSends ?? 0) > 0;

  const filename = invoiceFileName(invoice.invoice_number);
  const subject = `${resend ? "Rappel — " : ""}Facture ${invoice.invoice_number}`;
  const dueLine = invoice.due_date ? `<p>Échéance : <strong>${invoice.due_date}</strong></p>` : "";

  const result = await sendEmail({
    to,
    toName: client?.name ?? null,
    subject,
    html:
      `<p>Bonjour,</p>` +
      `<p>Veuillez trouver ci-joint la facture <strong>${invoice.invoice_number}</strong>.</p>` +
      `<p>Montant : <strong>${amount}</strong><br/>Date d'émission : ${invoice.issue_date ?? "—"}</p>` +
      dueLine +
      `<p>Cordialement,<br/>Service Facturation</p>`,
    text:
      `Facture ${invoice.invoice_number}\n` +
      `Montant : ${amount}\n` +
      `Date d'émission : ${invoice.issue_date ?? "—"}\n` +
      (invoice.due_date ? `Échéance : ${invoice.due_date}\n` : "") +
      `\nLa facture est jointe au format PDF.`,
    // THE stored artifact. Not a re-render.
    attachments: [{ filename, contentBase64: Buffer.from(bytes).toString("base64") }],
  });

  if (!result.ok) {
    // A failed send stays retryable and is recorded as a failure, not silence.
    await writeAudit({
      action: AuditActions.INVOICE_SEND_FAILED,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "invoice",
      entityId: invoiceId,
      after: { invoice_number: invoice.invoice_number, error: result.error ?? "send_failed" },
    });
    return { ok: false, error: result.error ?? "send_failed" };
  }

  // The audit records WHICH artifact was delivered, by hash — so "what did the
  // customer actually receive" is answerable years later.
  await writeAudit({
    action: AuditActions.INVOICE_SENT,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    after: {
      invoice_number: invoice.invoice_number,
      document_id: artifact.documentId,
      content_sha256: artifact.contentSha256,
      resend,
    },
  });

  return { ok: true, sha256: artifact.contentSha256, resend };
}

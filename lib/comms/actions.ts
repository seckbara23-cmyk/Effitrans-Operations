"use server";

/**
 * Communications server actions (Phase 1.14). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Manual send model: trigger buttons (Email client / Notify client / Send
 * invite) render + queue + send via queueAndSend; the log offers Send now /
 * Retry / Cancel. Gated by communication:send (triggers/send) and
 * communication:manage (retry/cancel). Service-role writes; no client exposure.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { invoiceTotals } from "@/lib/finance/calc";
import { queueAndSend } from "./queue";
import { sendEmail } from "./provider";
import type { ActionResult } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

const money = (n: number, currency: string) => `${n.toLocaleString("fr-FR")} ${currency}`;
const portalUrl = (path: string) => `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}${path}`;

/** Client-facing recipients: the client's ACTIVE portal users, else client email. */
async function clientRecipients(
  supabase: Admin,
  tenantId: string,
  clientId: string | null,
): Promise<{ email: string; name: string | null }[]> {
  if (!clientId) return [];
  const { data: portalUsers } = await supabase
    .from("client_user")
    .select("email, name")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .eq("status", "ACTIVE");
  if (portalUsers && portalUsers.length > 0) return portalUsers.map((u) => ({ email: u.email, name: u.name }));
  const { data: client } = await supabase.from("client").select("email, name").eq("id", clientId).maybeSingle();
  return client?.email ? [{ email: client.email, name: client.name }] : [];
}

async function deliver(supabase: Admin, tenantId: string, actorId: string, id: string): Promise<ActionResult> {
  const { data: m } = await supabase
    .from("communication_message")
    .select("id, status, recipient_email, recipient_name, subject, body_html, body_text, retry_count")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!m) return { ok: false, error: "not_found" };
  if (m.status !== "QUEUED" && m.status !== "FAILED") return { ok: false, error: "invalid_status" };

  const res = await sendEmail({
    to: m.recipient_email,
    toName: m.recipient_name,
    subject: m.subject,
    html: m.body_html,
    text: m.body_text,
  });
  if (res.ok) {
    await supabase.from("communication_message").update({ status: "SENT", sent_at: new Date().toISOString() }).eq("id", id);
    await writeAudit({ action: AuditActions.COMMUNICATION_SENT, actorId, tenantId, entity: "communication_message", entityId: id });
  } else {
    await supabase
      .from("communication_message")
      .update({ status: "FAILED", last_error: res.error ?? "send_failed", retry_count: m.retry_count + 1 })
      .eq("id", id);
    await writeAudit({ action: AuditActions.COMMUNICATION_FAILED, actorId, tenantId, entity: "communication_message", entityId: id, after: { error: res.error ?? null } });
  }
  revalidatePath("/communications");
  return res.ok ? { ok: true, id } : { ok: false, error: "send_failed" };
}

export async function sendMessage(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("communication:send");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  return deliver(getAdminSupabaseClient(), user.tenantId, user.id, id);
}

export async function retryMessage(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("communication:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  return deliver(getAdminSupabaseClient(), user.tenantId, user.id, id);
}

export async function cancelMessage(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("communication:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: m } = await supabase
    .from("communication_message")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!m) return { ok: false, error: "not_found" };
  if (m.status !== "QUEUED" && m.status !== "FAILED") return { ok: false, error: "invalid_status" };

  const { error } = await supabase.from("communication_message").update({ status: "CANCELLED" }).eq("id", id).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: AuditActions.COMMUNICATION_CANCELLED, actorId: user.id, tenantId: user.tenantId, entity: "communication_message", entityId: id });
  revalidatePath("/communications");
  return { ok: true, id };
}

// ------------------------------------------------------------- trigger emails ----

export async function emailInvoiceIssued(invoiceId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("communication:send");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: inv } = await supabase
    .from("invoice")
    .select("id, status, invoice_number, due_date, file_id, client_id, currency")
    .eq("id", invoiceId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!inv) return { ok: false, error: "not_found" };
  if (!["ISSUED", "PARTIALLY_PAID", "PAID"].includes(inv.status)) return { ok: false, error: "not_issued" };

  const { data: lines } = await supabase.from("invoice_line").select("quantity, unit_amount, tax_rate").eq("invoice_id", invoiceId);
  const { total } = invoiceTotals((lines ?? []).map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) })));

  const recipients = await clientRecipients(supabase, user.tenantId, inv.client_id);
  if (recipients.length === 0) return { ok: false, error: "no_recipient" };

  let count = 0;
  for (const r of recipients) {
    await queueAndSend({
      tenantId: user.tenantId,
      createdBy: user.id,
      templateKey: "invoice_issued",
      recipientEmail: r.email,
      recipientName: r.name,
      related: "invoice",
      relatedId: inv.id,
      fileId: inv.file_id,
      clientId: inv.client_id,
      vars: {
        clientName: r.name ?? "",
        invoiceNumber: inv.invoice_number ?? "",
        total: money(total, inv.currency),
        dueDate: inv.due_date ?? "",
        portalLink: portalUrl(`/portal/invoices/${inv.id}`),
      },
    });
    count += 1;
  }
  if (inv.file_id) revalidatePath(`/files/${inv.file_id}`);
  revalidatePath("/communications");
  return { ok: true, count };
}

export async function emailDocumentShared(documentId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("communication:send");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: doc } = await supabase
    .from("document")
    .select("id, file_id, status, shared_with_client, doc_type:type_code(label_fr), file:file_id(file_number, client_id)")
    .eq("id", documentId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{ id: string; file_id: string; status: string; shared_with_client: boolean; doc_type: { label_fr: string } | null; file: { file_number: string; client_id: string | null } | null }>();
  if (!doc) return { ok: false, error: "not_found" };
  if (!doc.shared_with_client || doc.status !== "APPROVED") return { ok: false, error: "not_shared" };

  const clientId = doc.file?.client_id ?? null;
  const recipients = await clientRecipients(supabase, user.tenantId, clientId);
  if (recipients.length === 0) return { ok: false, error: "no_recipient" };

  let count = 0;
  for (const r of recipients) {
    await queueAndSend({
      tenantId: user.tenantId,
      createdBy: user.id,
      templateKey: "document_shared",
      recipientEmail: r.email,
      recipientName: r.name,
      related: "document",
      relatedId: doc.id,
      fileId: doc.file_id,
      clientId,
      vars: {
        clientName: r.name ?? "",
        documentType: doc.doc_type?.label_fr ?? "",
        fileNumber: doc.file?.file_number ?? "",
        portalLink: portalUrl("/portal/documents"),
      },
    });
    count += 1;
  }
  revalidatePath(`/files/${doc.file_id}`);
  revalidatePath("/communications");
  return { ok: true, count };
}

export async function emailPortalInvite(clientUserId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("communication:send");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: cu } = await supabase
    .from("client_user")
    .select("id, email, name, client_id")
    .eq("id", clientUserId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!cu) return { ok: false, error: "not_found" };

  const { data: client } = await supabase.from("client").select("name").eq("id", cu.client_id).maybeSingle();
  const { data: link } = await supabase.auth.admin.generateLink({ type: "recovery", email: cu.email });
  const inviteLink = link?.properties?.action_link ?? portalUrl("/portal/login");

  const res = await queueAndSend({
    tenantId: user.tenantId,
    createdBy: user.id,
    templateKey: "portal_invite",
    recipientEmail: cu.email,
    recipientName: cu.name,
    related: "client_user",
    relatedId: cu.id,
    clientId: cu.client_id,
    vars: { clientName: client?.name ?? cu.name ?? "", inviterName: user.email, inviteLink },
  });
  revalidatePath(`/clients/${cu.client_id}`);
  revalidatePath("/communications");
  return res.id ? { ok: true, id: res.id } : { ok: false, error: "queue_failed" };
}

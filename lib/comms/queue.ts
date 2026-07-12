/**
 * Render + queue + send pipeline (Phase 1.14). SERVER-ONLY (internal helper).
 * ---------------------------------------------------------------------------
 * Called by the trigger actions: renders the template, stores the message
 * (QUEUED, rendered subject/body for auditability), then attempts delivery via
 * the provider (no-op by default) and records SENT/FAILED. Audits each step.
 * Not a server action — invoked from within comms/actions.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import type { Json } from "@/lib/db/types";
import { renderTemplate, type TemplateVars } from "./render";
import { mergeBranding } from "@/lib/branding/resolve";
import { sendEmail } from "./provider";
import type { TemplateKey } from "./templates";
import { reportMessage } from "@/lib/observability/report";

export type QueueInput = {
  tenantId: string;
  createdBy: string;
  templateKey: TemplateKey;
  vars: TemplateVars;
  recipientEmail: string;
  recipientName?: string | null;
  related?: string | null;
  relatedId?: string | null;
  fileId?: string | null;
  clientId?: string | null;
};

export async function queueAndSend(input: QueueInput): Promise<{ id: string | null; status: string }> {
  const supabase = getAdminSupabaseClient();

  // Tenant-resolved email branding (service-role read so it works even without a
  // user session, e.g. system-triggered notifications). The Effitrans backfill
  // keeps the footer identical; the header uses the tenant display name.
  const [{ data: brandOrg }, { data: brandRow }] = await Promise.all([
    supabase.from("organization").select("name, trade_name, legal_name").eq("id", input.tenantId).maybeSingle(),
    supabase
      .from("tenant_branding")
      .select("display_name, email_footer, primary_color")
      .eq("tenant_id", input.tenantId)
      .maybeSingle(),
  ]);
  const branding = mergeBranding(
    { name: brandOrg?.name ?? "", tradeName: brandOrg?.trade_name ?? null, legalName: brandOrg?.legal_name ?? null },
    brandRow,
  );
  const rendered = renderTemplate(input.templateKey, input.vars, {
    displayName: branding.displayName,
    emailFooter: branding.emailFooter ?? branding.displayName,
    primaryColor: branding.primaryColor ?? "#0b1f3a",
  });

  const { data, error } = await supabase
    .from("communication_message")
    .insert({
      tenant_id: input.tenantId,
      recipient_email: input.recipientEmail,
      recipient_name: input.recipientName ?? null,
      template_key: input.templateKey,
      subject: rendered.subject,
      body_html: rendered.html,
      body_text: rendered.text,
      payload: input.vars as Json,
      status: "QUEUED",
      related_entity: input.related ?? null,
      related_entity_id: input.relatedId ?? null,
      file_id: input.fileId ?? null,
      client_id: input.clientId ?? null,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) return { id: null, status: "error" };

  await writeAudit({
    action: AuditActions.COMMUNICATION_QUEUED,
    actorId: input.createdBy,
    tenantId: input.tenantId,
    entity: "communication_message",
    entityId: data.id,
    after: { template: input.templateKey, to: input.recipientEmail },
  });

  const res = await sendEmail({
    to: input.recipientEmail,
    toName: input.recipientName ?? null,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (res.ok) {
    await supabase
      .from("communication_message")
      .update({ status: "SENT", sent_at: new Date().toISOString() })
      .eq("id", data.id);
    await writeAudit({
      action: AuditActions.COMMUNICATION_SENT,
      actorId: input.createdBy,
      tenantId: input.tenantId,
      entity: "communication_message",
      entityId: data.id,
    });
    return { id: data.id, status: "SENT" };
  }

  await supabase
    .from("communication_message")
    .update({ status: "FAILED", last_error: res.error ?? "send_failed", retry_count: 1 })
    .eq("id", data.id);
  reportMessage("email send failed", {
    scope: "comms",
    event: "comms.send_failed",
    extra: { messageId: data.id, template: input.templateKey, error: res.error ?? "send_failed" },
  });
  await writeAudit({
    action: AuditActions.COMMUNICATION_FAILED,
    actorId: input.createdBy,
    tenantId: input.tenantId,
    entity: "communication_message",
    entityId: data.id,
    after: { error: res.error ?? null },
  });
  return { id: data.id, status: "FAILED" };
}

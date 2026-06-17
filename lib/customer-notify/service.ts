/**
 * Customer notifications (Phase 2.5). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Generated from lifecycle events; lifecycle stays authoritative. Two channels
 * of ONE notification: the portal inbox (client_notification) + email via the
 * existing Communications Hub (queueAndSend / Resend) — no second comms engine.
 * IDEMPOTENT: a (event + entity) dedup key + the unique index guarantee one
 * notification per event (double release, webhook retry → one only). Email is
 * gated per portal user by their preferences; the portal inbox always records.
 * Best-effort — never throws (must not break the triggering business action).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { queueAndSend } from "@/lib/comms/queue";
import { reportError } from "@/lib/observability/report";
import { t } from "@/lib/i18n";
import { CUSTOMER_EVENTS, dedupKey, emailAllowed, type CustomerEvent } from "./events";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

export type NotifyParams = {
  event: CustomerEvent;
  fileId?: string;
  invoiceId?: string;
  /** Extra template vars (amount, deliveryDate, paymentDate). */
  vars?: Record<string, string | number | null | undefined>;
};

export type CustomerNotifyResult = "created" | "duplicate" | "skipped";

export async function notifyCustomer(
  supabase: Admin,
  ctx: { tenantId: string; actorId: string },
  params: NotifyParams,
): Promise<CustomerNotifyResult> {
  try {
    const def = CUSTOMER_EVENTS[params.event];
    const ev = (t.portal.notify.events as Record<string, { title: string; message: string }>)[params.event];

    // Resolve client + entity context.
    let clientId: string | null = null;
    let fileId: string | null = params.fileId ?? null;
    let invoiceId: string | null = params.invoiceId ?? null;
    let fileNumber: string | null = null;
    let clientName: string | null = null;
    let invoiceNumber: string | null = null;

    if (invoiceId) {
      const { data: inv } = await supabase
        .from("invoice")
        .select("file_id, invoice_number, file:file_id(client_id, file_number, client:client_id(name))")
        .eq("tenant_id", ctx.tenantId)
        .eq("id", invoiceId)
        .maybeSingle<{ file_id: string; invoice_number: string | null; file: { client_id: string | null; file_number: string | null; client: { name: string } | null } | null }>();
      if (!inv) return "skipped";
      invoiceNumber = inv.invoice_number;
      fileId = inv.file_id;
      clientId = inv.file?.client_id ?? null;
      fileNumber = inv.file?.file_number ?? null;
      clientName = inv.file?.client?.name ?? null;
    } else if (fileId) {
      const { data: f } = await supabase
        .from("operational_file")
        .select("client_id, file_number, client:client_id(name)")
        .eq("tenant_id", ctx.tenantId)
        .eq("id", fileId)
        .maybeSingle<{ client_id: string | null; file_number: string | null; client: { name: string } | null }>();
      if (!f) return "skipped";
      clientId = f.client_id;
      fileNumber = f.file_number;
      clientName = f.client?.name ?? null;
    }

    const entityId = invoiceId ?? fileId;
    if (!clientId || !entityId) return "skipped";
    const dk = dedupKey(params.event, entityId);

    // Portal inbox (dedup-guarded). The unique index is the race-proof backstop.
    const { data: created, error } = await supabase
      .from("client_notification")
      .insert({
        tenant_id: ctx.tenantId,
        client_id: clientId,
        event_type: params.event,
        category: def.category,
        template_key: def.template,
        title: ev?.title ?? params.event,
        body: ev?.message ?? "",
        file_id: fileId,
        invoice_id: invoiceId,
        dedup_key: dk,
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !created) {
      if (error && /duplicate|unique/i.test(error.message)) return "duplicate";
      reportError(error ?? new Error("client_notification insert failed"), { scope: "action", event: "customer_notify.create", extra: { event: params.event, entityId } });
      return "skipped";
    }

    await writeAudit({
      action: AuditActions.NOTIFICATION_CUSTOMER_CREATED,
      actorId: ctx.actorId,
      tenantId: ctx.tenantId,
      entity: "client_notification",
      entityId: created.id,
      after: { client: clientId, dossier: fileId, template: def.template, channel: "portal", event: params.event },
    });

    // Email channel via the Communications Hub — per active portal user, prefs-gated.
    const { data: recipients } = await supabase
      .from("client_user")
      .select("email, name, notify_email, notify_shipment, notify_invoice, notify_payment")
      .eq("tenant_id", ctx.tenantId)
      .eq("client_id", clientId)
      .eq("status", "ACTIVE")
      .returns<{ email: string; name: string | null; notify_email: boolean; notify_shipment: boolean; notify_invoice: boolean; notify_payment: boolean }[]>();

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const portalLink = invoiceId ? `${siteUrl}/portal/invoices/${invoiceId}` : `${siteUrl}/portal/files/${fileId}`;
    const vars = {
      clientName: clientName ?? "",
      fileNumber: fileNumber ?? "",
      status: ev?.message ?? "",
      portalLink,
      invoiceNumber: invoiceNumber ?? "",
      ...(params.vars ?? {}),
    };

    for (const r of recipients ?? []) {
      if (!emailAllowed(r, def.category)) continue;
      const res = await queueAndSend({
        tenantId: ctx.tenantId,
        createdBy: ctx.actorId,
        templateKey: def.template,
        vars,
        recipientEmail: r.email,
        recipientName: r.name,
        related: "client_notification",
        relatedId: created.id,
        fileId,
        clientId,
      });
      if (res.id) {
        await writeAudit({
          action: AuditActions.NOTIFICATION_CUSTOMER_SENT,
          actorId: ctx.actorId,
          tenantId: ctx.tenantId,
          entity: "communication_message",
          entityId: res.id,
          after: { communication: res.id, channel: "email", event: params.event },
        });
      }
    }

    return "created";
  } catch (e) {
    reportError(e, { scope: "action", event: "customer_notify.create", extra: { event: params.event } });
    return "skipped";
  }
}

// ----------------------------------------------------------- portal reads ----

export type ClientNotificationItem = {
  id: string;
  eventType: string;
  category: string;
  title: string;
  body: string;
  fileId: string | null;
  invoiceId: string | null;
  readAt: string | null;
  createdAt: string;
};

/** Own-client notifications (RLS user-context). Newest first. */
export async function listClientNotifications(limit = 50): Promise<ClientNotificationItem[]> {
  const ctx = getServerSupabaseClient();
  const { data } = await ctx
    .from("client_notification")
    .select("id, event_type, category, title, body, file_id, invoice_id, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; event_type: string; category: string; title: string; body: string; file_id: string | null; invoice_id: string | null; read_at: string | null; created_at: string }[]>();
  return (data ?? []).map((r) => ({
    id: r.id,
    eventType: r.event_type,
    category: r.category,
    title: r.title,
    body: r.body,
    fileId: r.file_id,
    invoiceId: r.invoice_id,
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
}

export async function unreadClientNotificationCount(): Promise<number> {
  const ctx = getServerSupabaseClient();
  const { count } = await ctx.from("client_notification").select("id", { count: "exact", head: true }).is("read_at", null);
  return count ?? 0;
}

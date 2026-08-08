"use server";

/**
 * EMP-3 — compose, reply, draft and send. The authorization boundary.
 *
 * Drafting and sending are separate acts and separate authorities
 * (RATIFY-EMP3-3 / maker-checker default):
 *
 *   draft  -> `communication:read`  — an agent may prepare correspondence
 *   send   -> `communication:send`  — already granted to six role templates
 *   manage -> `communication:manage` — cancel and reconcile
 *
 * No new permission was created; `SYSTEM_ADMIN` holds none of these.
 *
 * The SENDER IS RESOLVED SERVER-SIDE, always. The browser names a mailbox by
 * id; this module reads the address from `ec_mailbox` under the tenant
 * predicate. An arbitrary From can therefore never reach the provider, however
 * the request was constructed.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { isProviderConfigured } from "./provider";
import { dispatchMessage, reconcileStuckSend, outboundEnabled } from "./dispatch";
import {
  validateRecipients, buildReplyHeaders, buildReplyAudience, validateAttachmentRefs,
  idempotencyKeyFor, replySubject, MAX_SUBJECT, MAX_BODY,
  type AttachmentRef, type ReplySource,
} from "./compose";

export type OutboundResult =
  | { ok: true; id: string; status?: string }
  | { ok: false; error: string; detail?: string };

const PATH = "/mail";

export type ComposeInput = {
  mailboxId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  fileId?: string | null;
  clientId?: string | null;
  attachments?: AttachmentRef[];
  /** Present for a reply: the inbound message being answered. */
  replyToMessageId?: string | null;
  replyAll?: boolean;
};

/**
 * Resolve and authorize the sending mailbox.
 *
 * Four conditions, all required, all server-side: the mailbox exists, belongs
 * to THIS tenant, is ACTIVE (EMP-1's control), and the tenant's outbound flag
 * is on. A cross-tenant id fails on the tenant predicate rather than on a
 * comparison this code could forget to write.
 */
async function resolveMailbox(
  tenantId: string,
  mailboxId: string,
): Promise<{ ok: true; address: string; label: string } | { ok: false; error: string }> {
  if (!outboundEnabled()) return { ok: false, error: "outbound_disabled" };

  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("ec_mailbox")
    .select("id, address, label_fr, is_active")
    .eq("id", mailboxId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) return { ok: false, error: "mailbox_not_found" };
  const m = data as unknown as { address: string; label_fr: string; is_active: boolean };
  if (!m.is_active) return { ok: false, error: "mailbox_inactive" };
  return { ok: true, address: m.address, label: m.label_fr };
}

/** The inbound message a reply answers — read under the tenant predicate. */
async function loadReplySource(tenantId: string, messageRowId: string): Promise<ReplySource | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("ec_inbound_message")
    // bcc is NOT selected. It is not merely unused — it never enters this
    // process, so a reply cannot expose a blind recipient even by mistake.
    .select("message_id, in_reply_to, references_header, from_address, to_addresses, cc_addresses, subject")
    .eq("id", messageRowId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    messageId: (r.message_id as string | null) ?? null,
    inReplyTo: (r.in_reply_to as string | null) ?? null,
    referencesHeader: (r.references_header as string | null) ?? null,
    fromAddress: (r.from_address as string) ?? "",
    toAddresses: list(r.to_addresses),
    ccAddresses: list(r.cc_addresses),
    subject: (r.subject as string | null) ?? null,
  };
}

/**
 * Persist a draft. A draft is NOT a communication: it emits no event, it never
 * reaches the provider, and it can be edited or cancelled freely.
 */
export async function saveDraft(input: ComposeInput): Promise<OutboundResult> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:read")) return { ok: false, error: "forbidden" };

  const mailbox = await resolveMailbox(user.tenantId, input.mailboxId);
  if (!mailbox.ok) return { ok: false, error: mailbox.error };

  const prepared = await prepare(user.tenantId, input, mailbox.address);
  if (!prepared.ok) return prepared;

  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("communication_message")
    .insert({
      tenant_id: user.tenantId,
      created_by: user.id,
      // No template. The CHECK constraint couples kind and template_key, so a
      // free composition cannot be recorded as if it had been a template.
      template_key: null,
      kind: prepared.kind,
      status: "DRAFT",
      created_by_draft_at: new Date().toISOString(),
      mailbox_id: input.mailboxId,
      recipient_email: prepared.recipients.to[0],
      to_addresses: prepared.recipients.to,
      cc_addresses: prepared.recipients.cc,
      bcc_addresses: prepared.recipients.bcc,
      subject: prepared.subject,
      body_text: prepared.bodyText,
      body_html: prepared.bodyHtml,
      in_reply_to: prepared.headers?.inReplyTo ?? null,
      references_header: prepared.headers?.referencesHeader ?? null,
      reply_to_message_id: input.replyToMessageId ?? null,
      attachments: prepared.attachments,
      file_id: input.fileId ?? null,
      client_id: input.clientId ?? null,
      channel: "EMAIL",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, error: "draft_failed", detail: error?.message };
  const id = (data as unknown as { id: string }).id;

  await writeAudit({
    action: AuditActions.COMMUNICATION_DRAFTED, actorId: user.id, tenantId: user.tenantId,
    entity: "communication_message", entityId: id, after: { kind: prepared.kind },
  });
  revalidatePath(PATH);
  return { ok: true, id, status: "DRAFT" };
}

/** Shared validation for draft and send. */
async function prepare(
  tenantId: string,
  input: ComposeInput,
  senderAddress: string,
): Promise<
  | { ok: true; kind: "COMPOSE" | "REPLY"; recipients: { to: string[]; cc: string[]; bcc: string[] };
      subject: string; bodyText: string; bodyHtml: string;
      headers: ReturnType<typeof buildReplyHeaders> | null; attachments: AttachmentRef[] }
  | { ok: false; error: string; detail?: string }
> {
  let to = input.to ?? [];
  let cc = input.cc ?? [];
  let subject = (input.subject ?? "").slice(0, MAX_SUBJECT);
  let headers: ReturnType<typeof buildReplyHeaders> | null = null;
  let kind: "COMPOSE" | "REPLY" = "COMPOSE";

  if (input.replyToMessageId) {
    const source = await loadReplySource(tenantId, input.replyToMessageId);
    if (!source) return { ok: false, error: "reply_source_not_found" };
    kind = "REPLY";
    headers = buildReplyHeaders(source);
    subject = subject.trim() || headers.subject;
    // The caller may override the audience, but the default is derived from the
    // original's visible fields only.
    if (to.length === 0) {
      const audience = buildReplyAudience(source, senderAddress, input.replyAll === true);
      to = audience.to;
      cc = cc.length > 0 ? cc : audience.cc;
    }
  }

  const recipients = validateRecipients({ to, cc, bcc: input.bcc ?? [] }, senderAddress);
  if (!recipients.ok) return { ok: false, error: `recipients_${recipients.problem}`, detail: recipients.detail };

  const bodyText = (input.bodyText ?? "").slice(0, MAX_BODY);
  if (!bodyText.trim()) return { ok: false, error: "empty_body" };
  if (!subject.trim()) return { ok: false, error: "empty_subject" };

  const attachments = input.attachments ?? [];
  const att = validateAttachmentRefs(attachments);
  if (!att.ok) return { ok: false, error: `attachments_${att.problem}` };

  return {
    ok: true, kind, recipients: recipients.recipients, subject, bodyText,
    bodyHtml: toHtml(bodyText), headers, attachments,
  };
}

/** Plain text to minimal HTML. Escaped first — the body is never trusted markup. */
function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${escaped}</div>`;
}

/**
 * Send. The ratified order, in order.
 *
 * A draft is promoted to QUEUED and dispatched in the same call, but through
 * the same CAS-protected path as any other send — the draft never bypasses it.
 */
export async function sendComposed(messageId: string): Promise<OutboundResult> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  // 1. authorize — sending is its own authority, distinct from drafting.
  if (!hasPermission(permissions, "communication:send")) return { ok: false, error: "forbidden" };

  if (!outboundEnabled()) return { ok: false, error: "outbound_disabled" };
  // RATIFY-EMP3-2: refuse before anything else changes state, and say so
  // plainly rather than reporting a success nothing produced.
  if (!isProviderConfigured()) return { ok: false, error: "provider_not_configured" };

  const admin = getAdminSupabaseClient();
  const { data: row } = await admin
    .from("communication_message")
    .select("id, status, mailbox_id, kind")
    .eq("id", messageId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  const m = row as unknown as { status: string; mailbox_id: string | null };

  // 2. validate the mailbox at SEND time, not only at draft time: it may have
  // been deactivated while the draft sat in the queue.
  if (m.mailbox_id) {
    const mailbox = await resolveMailbox(user.tenantId, m.mailbox_id);
    if (!mailbox.ok) return { ok: false, error: mailbox.error };
  }

  if (m.status === "SENT") return { ok: false, error: "already_sent" };
  if (m.status === "SENDING") return { ok: false, error: "already_in_flight" };
  if (m.status === "CANCELLED") return { ok: false, error: "cancelled" };

  // 3. promote the draft and stamp the idempotency key. The key is derived from
  // the row id, so a retry of this same message reuses it and a genuinely new
  // message cannot collide with it.
  if (m.status === "DRAFT") {
    const { error } = await admin
      .from("communication_message")
      .update({ status: "QUEUED", idempotency_key: idempotencyKeyFor(messageId) })
      .eq("id", messageId)
      .eq("tenant_id", user.tenantId)
      .eq("status", "DRAFT"); // CAS here too: two promoters, one winner.
    if (error) return { ok: false, error: "queue_failed", detail: error.message };
  }

  // 4-8. dispatch: CAS, provider, evidence, event, audit.
  const outcome = await dispatchMessage(user.tenantId, user.id, messageId);
  revalidatePath(PATH);

  if (outcome.ok) return { ok: true, id: messageId, status: outcome.status };
  return { ok: false, error: outcome.error };
}

/** Compose and send in one act, for a user who has both authorities. */
export async function composeAndSend(input: ComposeInput): Promise<OutboundResult> {
  const draft = await saveDraft(input);
  if (!draft.ok) return draft;
  return sendComposed(draft.id);
}

/** Cancel a draft or a queued message. Sent evidence can never be cancelled. */
export async function cancelOutbound(messageId: string): Promise<OutboundResult> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:manage")) return { ok: false, error: "forbidden" };

  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("communication_message")
    .update({ status: "CANCELLED" })
    .eq("id", messageId)
    .eq("tenant_id", user.tenantId)
    .in("status", ["DRAFT", "QUEUED", "FAILED"])
    .select("id")
    .maybeSingle();
  if (!data) return { ok: false, error: "not_cancellable" };

  await writeAudit({
    action: AuditActions.COMMUNICATION_CANCELLED, actorId: user.id, tenantId: user.tenantId,
    entity: "communication_message", entityId: messageId,
  });
  revalidatePath(PATH);
  return { ok: true, id: messageId, status: "CANCELLED" };
}

/**
 * Resolve a send stuck in SENDING. Human-only, audited, and offering only the
 * two outcomes the platform can honestly record — never "it was sent".
 */
export async function reconcileOutbound(
  messageId: string,
  outcome: "FAILED" | "CANCELLED",
  note: string,
): Promise<OutboundResult> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:manage")) return { ok: false, error: "forbidden" };

  const done = await reconcileStuckSend(
    getAdminSupabaseClient(), user.tenantId, user.id, messageId, outcome, note,
  );
  revalidatePath(PATH);
  return done ? { ok: true, id: messageId, status: outcome } : { ok: false, error: "not_in_flight" };
}

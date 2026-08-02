import "server-only";

/**
 * EC-2 — triage queue reads. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Composition over EC-1's immutable capture. Nothing here writes, and nothing
 * here reads a body: the queue and the detail view deal in identifiers,
 * classifications and metadata. Body access is a separate, deliberate act
 * (see `readBodyText` and `signAttachment` in ./actions).
 *
 * QUARANTINE IS NOT REACHABLE FROM HERE. Quarantined captures carry
 * tenant_id = NULL, so every query below — all tenant-scoped — excludes them
 * structurally. No filter, flag or parameter can surface them, which is the
 * point: they belong to no tenant.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { TriageOutcome, TriageStatus } from "./model";

export * from "./model";

export type TriageQueueItem = {
  id: string;
  messageId: string;
  status: TriageStatus;
  assignedTo: string | null;
  assignedAt: string | null;
  outcome: TriageOutcome | null;
  outcomeFileId: string | null;
  discardReasonCode: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** From the captured message — identifiers and the subject line only. */
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  receivedAt: string;
  mailboxId: string | null;
  mailboxAddress: string | null;
  mailboxPurpose: string | null;
  attachmentCount: number;
};

export type TriageFilters = {
  status?: TriageStatus;
  mailboxId?: string;
  purpose?: string;
  assignedTo?: string;
  /** Unassigned only — the "up for grabs" view. */
  unassigned?: boolean;
  /** Substring match on sender address. Sanitized before it reaches PostgREST. */
  sender?: string;
  from?: string; // ISO date, inclusive
  to?: string;   // ISO date, inclusive
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any, attachments: Map<string, number>): TriageQueueItem {
  const m = Array.isArray(r.ec_inbound_message) ? r.ec_inbound_message[0] : r.ec_inbound_message;
  const mb = m && (Array.isArray(m.ec_mailbox) ? m.ec_mailbox[0] : m.ec_mailbox);
  return {
    id: r.id,
    messageId: r.message_id,
    status: r.status as TriageStatus,
    assignedTo: r.assigned_to,
    assignedAt: r.assigned_at,
    outcome: r.outcome as TriageOutcome | null,
    outcomeFileId: r.outcome_file_id,
    discardReasonCode: r.discard_reason_code,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    fromAddress: m?.from_address ?? "",
    fromName: m?.from_name ?? null,
    subject: m?.subject ?? null,
    receivedAt: m?.received_at ?? r.created_at,
    mailboxId: m?.mailbox_id ?? null,
    mailboxAddress: mb?.address ?? null,
    mailboxPurpose: mb?.purpose ?? null,
    attachmentCount: attachments.get(r.message_id) ?? 0,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SELECT =
  "id, message_id, status, assigned_to, assigned_at, outcome, outcome_file_id, discard_reason_code, resolved_at, created_at, ec_inbound_message!inner(from_address, from_name, subject, received_at, mailbox_id, ec_mailbox(address, purpose))";

/** The queue. Tenant-scoped, so quarantined captures are excluded by construction. */
export async function listTriageQueue(
  tenantId: string,
  filters: TriageFilters = {},
  limit = 200,
): Promise<TriageQueueItem[]> {
  const s = getAdminSupabaseClient();
  let q = s.from("ec_triage_item").select(SELECT).eq("tenant_id", tenantId);

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
  if (filters.unassigned) q = q.is("assigned_to", null);
  if (filters.mailboxId) q = q.eq("ec_inbound_message.mailbox_id", filters.mailboxId);
  if (filters.purpose) q = q.eq("ec_inbound_message.ec_mailbox.purpose", filters.purpose);
  if (filters.sender) {
    // Strip PostgREST filter metacharacters — a sender box is a search field,
    // never a query language.
    const term = filters.sender.replace(/[%,()*]/g, " ").trim().slice(0, 120);
    if (term) q = q.ilike("ec_inbound_message.from_address", `%${term}%`);
  }
  if (filters.from) q = q.gte("ec_inbound_message.received_at", filters.from);
  if (filters.to) q = q.lte("ec_inbound_message.received_at", `${filters.to}T23:59:59.999Z`);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`[ec] triage queue read failed: ${error.message}`);

  const rows = data ?? [];
  const counts = await attachmentCounts(tenantId, rows.map((r) => r.message_id));
  return rows.map((r) => mapRow(r, counts));
}

async function attachmentCounts(tenantId: string, messageIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (messageIds.length === 0) return out;
  const s = getAdminSupabaseClient();
  const { data } = await s.from("ec_inbound_attachment")
    .select("message_id").eq("tenant_id", tenantId).in("message_id", messageIds);
  for (const r of data ?? []) out.set(r.message_id, (out.get(r.message_id) ?? 0) + 1);
  return out;
}

export type TriageAttachment = {
  id: string; filename: string; mimeType: string | null; sizeBytes: number;
  sha256: string | null; stored: boolean; rejectionReason: string | null;
};

export type TriageDetail = TriageQueueItem & {
  /** Header names/values as captured. Never a body. */
  headers: Record<string, string>;
  toAddresses: string[];
  ccAddresses: string[];
  messageIdHeader: string | null;
  threadKey: string | null;
  rawSha256: string;
  hasTextBody: boolean;
  hasHtmlBody: boolean;
  attachments: TriageAttachment[];
  outcomeComment: string | null;
  outcomeRecordedBy: string | null;
  outcomeRecordedAt: string | null;
};

export async function getTriageDetail(tenantId: string, itemId: string): Promise<TriageDetail | null> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("ec_triage_item")
    .select("id, message_id, status, assigned_to, assigned_at, outcome, outcome_file_id, discard_reason_code, resolved_at, created_at, outcome_comment, outcome_recorded_by, outcome_recorded_at")
    .eq("tenant_id", tenantId).eq("id", itemId).maybeSingle();
  if (error) throw new Error(`[ec] triage detail read failed: ${error.message}`);
  if (!data) return null;

  const { data: msg } = await s.from("ec_inbound_message")
    .select("from_address, from_name, subject, received_at, mailbox_id, headers, to_addresses, cc_addresses, message_id, thread_key, raw_sha256, text_body_path, html_body_path")
    .eq("tenant_id", tenantId).eq("id", data.message_id).maybeSingle();
  if (!msg) return null;

  const { data: mb } = msg.mailbox_id
    ? await s.from("ec_mailbox").select("address, purpose").eq("id", msg.mailbox_id).maybeSingle()
    : { data: null };

  const { data: atts } = await s.from("ec_inbound_attachment")
    .select("id, filename, mime_type, size_bytes, sha256, stored, rejection_reason")
    .eq("tenant_id", tenantId).eq("message_id", data.message_id).order("created_at");

  return {
    id: data.id,
    messageId: data.message_id,
    status: data.status as TriageStatus,
    assignedTo: data.assigned_to,
    assignedAt: data.assigned_at,
    outcome: data.outcome as TriageOutcome | null,
    outcomeFileId: data.outcome_file_id,
    discardReasonCode: data.discard_reason_code,
    resolvedAt: data.resolved_at,
    createdAt: data.created_at,
    outcomeComment: data.outcome_comment,
    outcomeRecordedBy: data.outcome_recorded_by,
    outcomeRecordedAt: data.outcome_recorded_at,
    fromAddress: msg.from_address,
    fromName: msg.from_name,
    subject: msg.subject,
    receivedAt: msg.received_at,
    mailboxId: msg.mailbox_id,
    mailboxAddress: mb?.address ?? null,
    mailboxPurpose: mb?.purpose ?? null,
    headers: (msg.headers ?? {}) as Record<string, string>,
    toAddresses: (msg.to_addresses ?? []) as string[],
    ccAddresses: (msg.cc_addresses ?? []) as string[],
    messageIdHeader: msg.message_id,
    threadKey: msg.thread_key,
    rawSha256: msg.raw_sha256,
    hasTextBody: Boolean(msg.text_body_path),
    hasHtmlBody: Boolean(msg.html_body_path),
    attachmentCount: (atts ?? []).length,
    attachments: (atts ?? []).map((a) => ({
      id: a.id, filename: a.filename, mimeType: a.mime_type,
      sizeBytes: a.size_bytes, sha256: a.sha256, stored: a.stored,
      rejectionReason: a.rejection_reason,
    })),
  };
}

export type TriageCounts = {
  unassigned: number;
  assignedToMe: number;
  inReview: number;
  openTotal: number;
  /** Age in whole days of the oldest OPEN item, or null when the queue is empty. */
  oldestOpenDays: number | null;
};

/**
 * Attention counters, computed live on page load. No scheduler exists and none
 * was invented — the standing pattern since HR-5A.
 */
export async function triageCounts(tenantId: string, userId: string): Promise<TriageCounts> {
  const s = getAdminSupabaseClient();
  const head = { count: "exact" as const, head: true };
  const open = ["NEW", "ASSIGNED", "IN_REVIEW"];

  const [unassigned, mine, inReview, openTotal, oldest] = await Promise.all([
    s.from("ec_triage_item").select("id", head).eq("tenant_id", tenantId).in("status", open).is("assigned_to", null),
    s.from("ec_triage_item").select("id", head).eq("tenant_id", tenantId).in("status", open).eq("assigned_to", userId),
    s.from("ec_triage_item").select("id", head).eq("tenant_id", tenantId).eq("status", "IN_REVIEW"),
    s.from("ec_triage_item").select("id", head).eq("tenant_id", tenantId).in("status", open),
    s.from("ec_triage_item").select("created_at").eq("tenant_id", tenantId).in("status", open)
      .order("created_at", { ascending: true }).limit(1),
  ]);

  const oldestAt = oldest.data?.[0]?.created_at;
  return {
    unassigned: unassigned.count ?? 0,
    assignedToMe: mine.count ?? 0,
    inReview: inReview.count ?? 0,
    openTotal: openTotal.count ?? 0,
    oldestOpenDays: oldestAt
      ? Math.floor((Date.now() - new Date(oldestAt).getTime()) / 86_400_000)
      : null,
  };
}

/** Active mailboxes, for the filter bar. Configuration, not business state. */
export async function listMailboxes(tenantId: string) {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("ec_mailbox")
    .select("id, address, label_fr, purpose, is_active")
    .eq("tenant_id", tenantId).order("address");
  if (error) throw new Error(`[ec] mailbox read failed: ${error.message}`);
  return data ?? [];
}

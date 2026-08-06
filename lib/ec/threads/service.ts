/**
 * EMP-2 — thread reads. SERVER-ONLY, READ-ONLY.
 *
 * Reads through the RLS-BOUND client, exactly as EMP-1's mailbox service does:
 * EC-1's SELECT policies already enforce tenant isolation and
 * `communication:inbound:read`, so no gate is re-implemented here and no admin
 * client is involved. There is no write path in this module at all — the
 * capture is evidence, and a thread is a way of looking at it.
 *
 * SCALE. Resolving a conversation does not require the tenant's whole mailbox.
 * EC-1 already stores a per-message `thread_key` and indexes it
 * (`idx_ec_inbound_thread on (tenant_id, thread_key)`), which makes an excellent
 * CANDIDATE filter even though it is too weak to be an identity: a reply that
 * omits References derives a different key from its own root, so the key splits
 * threads that the full RFC rules join. So the key narrows, and
 * `resolveThreads` decides — the cheap index does the filtering, the exact
 * algorithm does the reasoning.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";
import {
  resolveThreads, linkedIdentifiers, normalizeMessageId,
  type ThreadInput, type ThreadAssignment,
} from "./resolve";

export type ThreadMessage = {
  rowId: string;
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  threadKey: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  receivedAt: string;
  captureStatus: string;
  mailboxId: string | null;
  /** How this message joined the conversation. */
  basis: ThreadAssignment["basis"];
};

export type ThreadView = {
  threadId: string;
  messages: ThreadMessage[];
  /**
   * True when expansion hit its bound before the conversation closed. The view
   * says so rather than presenting a partial thread as complete.
   */
  truncated: boolean;
};

/** Expansion bounds. A conversation larger than this is pathological. */
const MAX_HOPS = 4;
const MAX_MESSAGES = 400;

const SELECT =
  "id, message_id, in_reply_to, references_header, thread_key, from_address, from_name, " +
  "to_addresses, cc_addresses, subject, received_at, capture_status, mailbox_id";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toMessage(r: any, basis: ThreadAssignment["basis"]): ThreadMessage {
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    rowId: r.id,
    messageId: r.message_id ?? null,
    inReplyTo: r.in_reply_to ?? null,
    referencesHeader: r.references_header ?? null,
    threadKey: r.thread_key ?? null,
    fromAddress: r.from_address ?? "",
    fromName: r.from_name ?? null,
    toAddresses: list(r.to_addresses),
    ccAddresses: list(r.cc_addresses),
    subject: r.subject ?? null,
    receivedAt: r.received_at,
    captureStatus: r.capture_status,
    mailboxId: r.mailbox_id ?? null,
    basis,
  };
}
function toInput(r: any): ThreadInput {
  return {
    rowId: r.id,
    messageId: r.message_id ?? null,
    inReplyTo: r.in_reply_to ?? null,
    referencesHeader: r.references_header ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The conversation containing one message.
 *
 * Expansion is a fixed-point search: start from the seed, pull in every message
 * that shares one of its identifiers or its `thread_key`, then repeat with the
 * identifiers those messages introduce. It stops when a round adds nothing —
 * which is the point at which the conversation is provably complete — or when a
 * bound trips, which the caller is told about.
 */
export async function getThreadForMessage(
  tenantId: string,
  messageRowId: string,
): Promise<ThreadView | null> {
  const s = getServerSupabaseClient();

  const { data: seedRow } = await s
    .from("ec_inbound_message")
    .select(SELECT)
    .eq("id", messageRowId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!seedRow) return null;

  const seed = seedRow as unknown as { id: string };
  const byRow = new Map<string, unknown>([[seed.id, seedRow]]);
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  let frontier = [seedRow];
  let truncated = false;

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const ids: string[] = [];
    const keys: string[] = [];
    for (const row of frontier) {
      for (const id of linkedIdentifiers(toInput(row))) {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          ids.push(id);
        }
      }
      const key = (row as unknown as { thread_key: string | null }).thread_key;
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        keys.push(key);
      }
    }
    if (ids.length === 0 && keys.length === 0) break;

    // Three cheap indexed reads rather than one clever join. `references_header`
    // needs a substring match because it holds a list; the other two are exact.
    const [byMessageId, byInReplyTo, byKey, byRefs] = await Promise.all([
      ids.length ? s.from("ec_inbound_message").select(SELECT).eq("tenant_id", tenantId).in("message_id", ids) : null,
      ids.length ? s.from("ec_inbound_message").select(SELECT).eq("tenant_id", tenantId).in("in_reply_to", ids) : null,
      keys.length ? s.from("ec_inbound_message").select(SELECT).eq("tenant_id", tenantId).in("thread_key", keys) : null,
      ids.length
        ? s
            .from("ec_inbound_message")
            .select(SELECT)
            .eq("tenant_id", tenantId)
            .or(ids.map((id) => `references_header.ilike.%${id.replace(/[%,()]/g, "")}%`).join(","))
        : null,
    ]);

    const next: unknown[] = [];
    for (const res of [byMessageId, byInReplyTo, byKey, byRefs]) {
      for (const row of (res?.data ?? []) as unknown as { id: string }[]) {
        if (byRow.has(row.id)) continue;
        if (byRow.size >= MAX_MESSAGES) {
          truncated = true;
          break;
        }
        byRow.set(row.id, row);
        next.push(row);
      }
    }
    if (truncated || next.length === 0) break;
    frontier = next as typeof frontier;
  }

  // The exact algorithm decides, over the candidate set the index produced.
  const rows = [...byRow.values()];
  const assignments = resolveThreads(rows.map((r) => toInput(r)));
  const seedThread = assignments.find((a) => a.rowId === messageRowId)?.threadId;
  if (!seedThread) return null;

  const basisByRow = new Map(assignments.map((a) => [a.rowId, a.basis]));
  const members = rows
    .filter((r) => assignments.find((a) => a.rowId === (r as { id: string }).id)?.threadId === seedThread)
    .map((r) => toMessage(r, basisByRow.get((r as { id: string }).id) ?? "synthetic"))
    // Chronological, oldest first — a conversation reads forward. `received_at`
    // is the provider's stamp on the envelope, which is the only time this
    // platform has for a message it did not create.
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.rowId.localeCompare(b.rowId)));

  return { threadId: seedThread, messages: members, truncated };
}

/**
 * Find the message row carrying a given Message-ID, for search.
 * Tenant-scoped through RLS, so an id from another tenant simply is not found.
 */
export async function findByMessageId(tenantId: string, raw: string): Promise<string | null> {
  const id = normalizeMessageId(raw);
  if (!id) return null;
  const s = getServerSupabaseClient();
  const { data } = await s
    .from("ec_inbound_message")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("message_id", id)
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * EMP-1 — mailbox administration and mail operations, READ SIDE. SERVER-ONLY.
 *
 * EC-1 created `ec_mailbox` but no surface ever administered it: rows were
 * seeded by an operator, and a typo in an address silently sent real customer
 * mail to quarantine with nobody able to see why. This module is the read half
 * of the fix.
 *
 * It reads through the RLS-BOUND client, not the admin client. EC-1 already
 * wrote SELECT policies for all five `ec_*` tables
 * (`tenant_id = auth_tenant_id() AND has_permission('communication:inbound:read')`),
 * so the database enforces isolation here and the application gate on top of it
 * only ever NARROWS. The triage service reaches for the admin client; this one
 * does not need to, and where the weaker tool suffices it is the one to use.
 *
 * Nothing here reads a body, and nothing here can write.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";

export type MailboxHealth = {
  id: string;
  address: string;
  labelFr: string;
  purpose: string;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** Messages captured into this mailbox, all time. */
  messageCount: number;
  /** Newest capture, or null when the mailbox has never received anything. */
  lastReceivedAt: string | null;
  /** Open triage items pointing at this mailbox's messages. */
  openCount: number;
};

export type WebhookHealth = {
  lastReceivedAt: string | null;
  /** Counts by outcome over the window, for THIS tenant only (see below). */
  byOutcome: Record<string, number>;
  invalidSignatures: number;
  windowDays: number;
};

/** Provider/flag posture. Reads configuration only — never a secret's value. */
export type ProviderPosture = {
  inboundEnabled: boolean;
  tenantRolloutEnabled: boolean;
  /** True when a shared secret is configured. The secret itself never leaves. */
  webhookSecretConfigured: boolean;
};

const WINDOW_DAYS = 7;

function windowStart(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Every mailbox for the tenant, each with the operational facts an
 * administrator needs to answer "is this address working?".
 *
 * The per-mailbox counts are computed with grouped HEAD queries rather than one
 * join, because `ec_inbound_message` is the evidence table and this module is
 * not permitted to shape it.
 */
export async function listMailboxHealth(tenantId: string): Promise<MailboxHealth[]> {
  const s = getServerSupabaseClient();

  const { data: boxes } = await s
    .from("ec_mailbox")
    .select("id, address, label_fr, purpose, is_active, note, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("address");

  const rows = boxes ?? [];
  if (rows.length === 0) return [];

  // One read of the tenant's captures, folded in memory. A per-mailbox query
  // would be N round trips for a list that is inherently small (a tenant has a
  // handful of addresses, not thousands).
  const { data: msgs } = await s
    .from("ec_inbound_message")
    .select("id, mailbox_id, received_at")
    .eq("tenant_id", tenantId);

  const counts = new Map<string, { n: number; last: string | null; ids: string[] }>();
  for (const m of (msgs ?? []) as { id: string; mailbox_id: string | null; received_at: string }[]) {
    if (!m.mailbox_id) continue;
    const cur = counts.get(m.mailbox_id) ?? { n: 0, last: null, ids: [] };
    cur.n += 1;
    cur.ids.push(m.id);
    if (!cur.last || m.received_at > cur.last) cur.last = m.received_at;
    counts.set(m.mailbox_id, cur);
  }

  const { data: open } = await s
    .from("ec_triage_item")
    .select("message_id")
    .eq("tenant_id", tenantId)
    .in("status", ["NEW", "ASSIGNED", "IN_REVIEW"]);
  const openMessageIds = new Set((open ?? []).map((o) => (o as { message_id: string }).message_id));

  return rows.map((b) => {
    const c = counts.get(b.id as string);
    return {
      id: b.id as string,
      address: b.address as string,
      labelFr: b.label_fr as string,
      purpose: b.purpose as string,
      isActive: b.is_active as boolean,
      note: (b.note as string | null) ?? null,
      createdAt: b.created_at as string,
      updatedAt: b.updated_at as string,
      messageCount: c?.n ?? 0,
      lastReceivedAt: c?.last ?? null,
      openCount: c ? c.ids.filter((id) => openMessageIds.has(id)).length : 0,
    };
  });
}

export async function getMailboxHealth(tenantId: string, id: string): Promise<MailboxHealth | null> {
  const all = await listMailboxHealth(tenantId);
  return all.find((m) => m.id === id) ?? null;
}

/**
 * Webhook delivery posture for this tenant.
 *
 * IMPORTANT AND DELIBERATE: quarantined captures are absent from this count and
 * always will be. EC-1 stores them with `tenant_id = NULL` under a CHECK
 * constraint, so no tenant-scoped read can reach them. What a tenant sees here
 * is the health of mail that ARRIVED, not proof that nothing was rejected.
 * `describeQuarantineVisibility()` states that in the UI rather than letting a
 * zero be read as an all-clear.
 */
export async function getWebhookHealth(tenantId: string): Promise<WebhookHealth> {
  const s = getServerSupabaseClient();
  const since = windowStart(WINDOW_DAYS);

  const { data } = await s
    .from("ec_webhook_event")
    .select("outcome, signature_valid, received_at")
    .eq("tenant_id", tenantId)
    .gte("received_at", since)
    .order("received_at", { ascending: false });

  const rows = (data ?? []) as { outcome: string; signature_valid: boolean; received_at: string }[];
  const byOutcome: Record<string, number> = {};
  let invalidSignatures = 0;
  for (const r of rows) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    if (!r.signature_valid) invalidSignatures += 1;
  }

  return {
    lastReceivedAt: rows[0]?.received_at ?? null,
    byOutcome,
    invalidSignatures,
    windowDays: WINDOW_DAYS,
  };
}

/** Mail volume for the tenant over the health window, by day. */
export async function getMailVolume(tenantId: string): Promise<{ day: string; count: number }[]> {
  const s = getServerSupabaseClient();
  const { data } = await s
    .from("ec_inbound_message")
    .select("received_at")
    .eq("tenant_id", tenantId)
    .gte("received_at", windowStart(WINDOW_DAYS));

  const byDay = new Map<string, number>();
  for (const r of (data ?? []) as { received_at: string }[]) {
    const day = r.received_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, count]) => ({ day, count }));
}

export function getProviderPosture(tenantRolloutEnabled: boolean): ProviderPosture {
  return {
    inboundEnabled: process.env.EFFITRANS_EC_INBOUND_ENABLED === "true",
    tenantRolloutEnabled,
    // Configured-or-not, never the value. A surface that can display a secret
    // is a surface that can leak one.
    webhookSecretConfigured: Boolean(process.env.EC_INBOUND_WEBHOOK_SECRET?.trim()),
  };
}

/** Whether this tenant's inbound rollout row is enabled. */
export async function isTenantInboundEnabled(tenantId: string): Promise<boolean> {
  const s = getServerSupabaseClient();
  const { data } = await s
    .from("tenant_ec_inbound_rollout")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return Boolean((data as { enabled?: boolean } | null)?.enabled);
}

/**
 * The sentence the Quarantine view shows instead of an empty table.
 *
 * EC-1 made quarantine tenant-less BY CONSTRUCTION: the CHECK constraint
 * `ec_inbound_quarantine_shape` requires `tenant_id IS NULL` whenever
 * `capture_status = 'QUARANTINED'`. A tenant-scoped quarantine list is
 * therefore permanently empty — not "empty right now".
 *
 * Saying so is the point. An empty grid would read as "no mail was rejected",
 * which is a claim this platform cannot make, and a future engineer seeing a
 * blank view would be tempted to "fix" it by weakening the constraint.
 */
export const QUARANTINE_VISIBILITY_NOTICE =
  "Les messages mis en quarantaine n'appartiennent à aucun tenant : la contrainte de capture " +
  "impose tenant_id NULL, et aucune lecture applicative ne peut donc les atteindre. Cette vue " +
  "est vide par construction, et non parce qu'aucun message n'a été rejeté. Leur examen relève " +
  "de l'opérateur de la plateforme (RATIFY-EMP-11).";

/* ------------------------------------------------------------------- EMP-1
 * Capture evidence for ONE message: how it arrived, and what the platform
 * recorded about that arrival.
 *
 * This is the "routing history" and "quarantine history" the mail workspace
 * shows. Both come from rows EC-1 already writes and marks immutable — this
 * reads them, and there is nothing here that could alter them.
 */

export type CaptureEvidence = {
  provider: string;
  providerEventId: string;
  providerMessageId: string | null;
  captureStatus: string;
  quarantineReason: string | null;
  rawSha256: string;
  rawSizeBytes: number;
  capturedAt: string;
  /** Every webhook delivery recorded under this message's provider event id. */
  deliveries: {
    id: string;
    outcome: string;
    signatureValid: boolean;
    detail: string | null;
    receivedAt: string;
  }[];
};

export async function getCaptureEvidence(
  tenantId: string,
  messageId: string,
): Promise<CaptureEvidence | null> {
  const s = getServerSupabaseClient();

  const { data: msg } = await s
    .from("ec_inbound_message")
    .select(
      "provider, provider_event_id, provider_message_id, capture_status, " +
        "quarantine_reason, raw_sha256, raw_size_bytes, captured_at",
    )
    .eq("id", messageId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!msg) return null;

  const m = msg as unknown as Record<string, unknown>;

  // The delivery journal is keyed by (provider, provider_event_id) — the same
  // pair the message carries — so a retried delivery shows as a DUPLICATE row
  // beside the original rather than silently replacing it.
  const { data: hooks } = await s
    .from("ec_webhook_event")
    .select("id, outcome, signature_valid, detail, received_at")
    .eq("tenant_id", tenantId)
    .eq("provider", m.provider as string)
    .eq("provider_event_id", m.provider_event_id as string)
    .order("received_at", { ascending: true });

  return {
    provider: m.provider as string,
    providerEventId: m.provider_event_id as string,
    providerMessageId: (m.provider_message_id as string | null) ?? null,
    captureStatus: m.capture_status as string,
    quarantineReason: (m.quarantine_reason as string | null) ?? null,
    rawSha256: m.raw_sha256 as string,
    rawSizeBytes: Number(m.raw_size_bytes ?? 0),
    capturedAt: m.captured_at as string,
    deliveries: (hooks ?? []).map((h) => {
      const r = h as unknown as Record<string, unknown>;
      return {
        id: r.id as string,
        outcome: r.outcome as string,
        signatureValid: r.signature_valid as boolean,
        detail: (r.detail as string | null) ?? null,
        receivedAt: r.received_at as string,
      };
    }),
  };
}

/** French labels for the capture outcomes EC-1 records. */
export const CAPTURE_OUTCOME_FR: Record<string, string> = {
  CAPTURED: "Capturé",
  DUPLICATE: "Doublon ignoré",
  QUARANTINED: "Mis en quarantaine",
  REJECTED: "Rejeté",
  ERROR: "Erreur",
};

/**
 * EC-1 — PURE parsing, normalization and routing helpers. No I/O, no imports
 * from the app. Unit-tested without network, database or storage.
 * ---------------------------------------------------------------------------
 * Everything here is a decision that must be provably correct BEFORE it touches
 * a tenant's data: which address a message was sent to, whether the routing is
 * unambiguous, whether a filename is safe, whether a payload is oversized.
 */

/** Hard ceiling on a single webhook body. Refused before any parsing work. */
export const MAX_WEBHOOK_BYTES = 26_214_400; // 25 MiB — matches the bucket limit

/** Attachment bytes we extract. Anything larger is recorded but not stored. */
export const MAX_ATTACHMENT_BYTES = 15_728_640; // 15 MiB — messaging-attachments parity

/**
 * Attachment types whose BYTES we extract into the bucket. Everything else is
 * still recorded (name, size, hash) — the raw envelope holds it regardless, so
 * refusing extraction loses no evidence, only storage hygiene.
 */
export const ALLOWED_ATTACHMENT_MIME: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
];

export function isAllowedAttachmentMime(mime: string | null): boolean {
  if (!mime) return false;
  return ALLOWED_ATTACHMENT_MIME.includes(mime.split(";")[0].trim().toLowerCase());
}

/**
 * Normalize an email address for comparison and storage: trim, strip a display
 * name and angle brackets, lowercase. Returns null when nothing usable remains.
 *
 * `"Awa Ndiaye" <Awa@Example.COM>` → `awa@example.com`
 */
export function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angled = raw.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase();
  if (!candidate || !candidate.includes("@")) return null;
  // An address with whitespace inside is malformed, not merely untidy.
  if (/\s/.test(candidate)) return null;
  if (candidate.length > 320) return null;
  return candidate;
}

/** Display name from `"Name" <addr>`, or null. Never used for routing. */
export function extractDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  const name = m?.[1]?.trim();
  return name ? name.slice(0, 200) : null;
}

/** Normalize a list of address strings, dropping unusable entries, deduped. */
export function normalizeAddressList(raw: readonly (string | null | undefined)[] | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const item of raw) {
    const a = normalizeAddress(item);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

/**
 * Strip any path, collapse dangerous characters, cap length. Never trust a
 * filename that arrived from the internet. Same rule as
 * lib/messaging/attachments.ts — restated here rather than imported because
 * that module is `server-only` and this one must stay pure.
 */
export function sanitizeFilename(name: string | null | undefined): string {
  const base = (name ?? "").split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\-]+/, "");
  return cleaned.slice(0, 120) || "piece-jointe";
}

/**
 * The thread key: the root of the References chain when present, else
 * In-Reply-To, else this message's own Message-ID. Purely structural — EC-4
 * will correlate on it; EC-1 only records it.
 */
export function deriveThreadKey(input: {
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
}): string | null {
  const first = input.referencesHeader?.trim().split(/\s+/)[0];
  return first || input.inReplyTo || input.messageId || null;
}

/** A mailbox as the resolver sees it. */
export type MailboxRow = {
  id: string;
  tenantId: string;
  address: string;
  isActive: boolean;
};

export type RoutingResult =
  | { routed: true; tenantId: string; mailboxId: string }
  | { routed: false; reason: "no_matching_mailbox" | "ambiguous_routing" | "mailbox_inactive" };

/**
 * THE routing decision (rule 3). Given the recipients of a message and the
 * mailboxes that matched them, decide the tenant — or refuse.
 *
 * Refuses, deliberately, when:
 *   * nothing matched                       → no_matching_mailbox
 *   * more than one DISTINCT mailbox matched → ambiguous_routing
 *   * the single match is inactive           → mailbox_inactive
 *
 * Two recipients resolving to the SAME mailbox is not ambiguous — that is one
 * destination named twice (To and Cc, say), and refusing it would be pedantry.
 * Two DIFFERENT mailboxes is ambiguous even within one tenant: EC-2 dispatches
 * on the mailbox, so guessing which one would be guessing the workflow.
 *
 * Tenant ownership is NEVER inferred from the sender, the content, or anything
 * else — only from an explicitly configured recipient address.
 */
export function resolveRouting(matches: readonly MailboxRow[]): RoutingResult {
  if (matches.length === 0) return { routed: false, reason: "no_matching_mailbox" };

  const distinct = new Map<string, MailboxRow>();
  for (const m of matches) distinct.set(m.id, m);

  if (distinct.size > 1) return { routed: false, reason: "ambiguous_routing" };

  const only = [...distinct.values()][0];
  if (!only.isActive) return { routed: false, reason: "mailbox_inactive" };
  return { routed: true, tenantId: only.tenantId, mailboxId: only.id };
}

/** Storage path for one tenant's evidence. Tenant-scoped by construction. */
export function inboundStoragePath(
  scope: string,
  messageId: string,
  leaf: string,
): string {
  const safeScope = /^[0-9a-f-]{36}$/i.test(scope) ? scope : "quarantine";
  return `${safeScope}/${messageId}/${leaf}`;
}

/** True when the raw body exceeds the hard ceiling (measured in BYTES, not chars). */
export function isOversized(rawBody: string, max = MAX_WEBHOOK_BYTES): boolean {
  return Buffer.byteLength(rawBody, "utf8") > max;
}

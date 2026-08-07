/**
 * EMP-3 — composition rules. PURE. No I/O, no client, no clock.
 *
 * Everything that decides WHAT an outbound message says about itself lives
 * here, so it can be tested exhaustively without a database: recipient
 * validation, reply-header construction, reply-all audience, and the
 * idempotency key.
 *
 * The governing rule for replies is the same one EMP-2 established for
 * correlation: **never fabricate an identifier**. If the message being answered
 * carries no usable Message-ID, the reply gets no In-Reply-To and no
 * References. It becomes a new conversation that is still visibly linked to the
 * original in the workspace — which is honest — rather than a message carrying
 * a forged chain, which would corrupt correlation for everyone downstream.
 */
import { normalizeMessageId, parseReferences } from "@/lib/ec/threads/resolve";

export const MAX_RECIPIENTS = 50;
export const MAX_SUBJECT = 400;
export const MAX_BODY = 200_000;

/** RFC 5321 practical limit; also the platform's `ec_mailbox` address bound. */
const MAX_ADDRESS = 320;

/**
 * Address syntax. Deliberately strict and deliberately NOT a full RFC 5322
 * parser: this is a gate on what we will send to, not a spec implementation.
 * Anything with whitespace, a comma, or a control character is refused, which
 * is what closes header injection.
 */
const ADDRESS = /^[^\s@,<>";:\\]+@[^\s@,<>";:\\.]+(\.[^\s@,<>";:\\.]+)+$/;

export function isValidAddress(raw: string): boolean {
  const v = raw.trim();
  if (!v || v.length > MAX_ADDRESS) return false;
  // A newline anywhere is header injection, not a bad address. Checked
  // explicitly because a regex anchored with ^...$ can otherwise be satisfied
  // by the first line of a multi-line value.
  if (/[\r\n\0]/.test(raw)) return false;
  return ADDRESS.test(v);
}

/** Lower-cased for comparison ONLY. The stored form keeps the user's casing. */
function key(address: string): string {
  return address.trim().toLowerCase();
}

export type RecipientSet = { to: string[]; cc: string[]; bcc: string[] };

export type RecipientProblem =
  | "empty"
  | "invalid_address"
  | "too_many"
  | "sender_in_recipients"
  | "header_injection";

export type RecipientResult =
  | { ok: true; recipients: RecipientSet }
  | { ok: false; problem: RecipientProblem; detail?: string };

/**
 * Validate and normalize an audience.
 *
 * De-duplication is deterministic and cross-field: an address in To wins over
 * the same address in Cc, and Cc over Bcc. Without that ordering the same
 * person could be both a visible and a blind recipient of one message, which is
 * a privacy defect rather than a cosmetic one.
 *
 * The sending mailbox is refused in any field. Mail to oneself would be
 * captured by EC-1 as a new inbound message and re-enter triage as if a
 * customer had written in.
 */
export function validateRecipients(
  input: { to: string[]; cc?: string[]; bcc?: string[] },
  senderAddress: string,
): RecipientResult {
  const seen = new Set<string>();
  const senderKey = key(senderAddress);
  const out: RecipientSet = { to: [], cc: [], bcc: [] };

  const fields: (keyof RecipientSet)[] = ["to", "cc", "bcc"];
  let total = 0;

  for (const field of fields) {
    const raw = field === "to" ? input.to : field === "cc" ? (input.cc ?? []) : (input.bcc ?? []);
    for (const candidate of raw) {
      if (typeof candidate !== "string") return { ok: false, problem: "invalid_address" };
      if (/[\r\n\0]/.test(candidate)) return { ok: false, problem: "header_injection", detail: field };
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (!isValidAddress(trimmed)) return { ok: false, problem: "invalid_address", detail: trimmed };

      const k = key(trimmed);
      if (k === senderKey) return { ok: false, problem: "sender_in_recipients", detail: trimmed };
      if (seen.has(k)) continue; // first field wins — To > Cc > Bcc
      seen.add(k);
      out[field].push(trimmed);
      total += 1;
      if (total > MAX_RECIPIENTS) return { ok: false, problem: "too_many" };
    }
  }

  if (out.to.length === 0) return { ok: false, problem: "empty" };
  return { ok: true, recipients: out };
}

/** The inbound message being answered, as the reply builder sees it. */
export type ReplySource = {
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
};

export type ReplyHeaders = {
  inReplyTo: string | null;
  referencesHeader: string | null;
  subject: string;
  /** True when the source carried no usable identifier — a new conversation. */
  startsNewThread: boolean;
};

/**
 * Build the RFC headers for a reply.
 *
 * References is the parent's References plus the parent's own Message-ID, in
 * that order — the chain as RFC 5322 defines it. If the parent has no
 * Message-ID we do NOT invent one and do NOT emit a partial chain: both headers
 * come back null and `startsNewThread` says why.
 */
export function buildReplyHeaders(source: ReplySource): ReplyHeaders {
  const parentId = normalizeMessageId(source.messageId);
  const subject = replySubject(source.subject);

  if (!parentId) {
    return { inReplyTo: null, referencesHeader: null, subject, startsNewThread: true };
  }

  const chain = parseReferences(source.referencesHeader);
  if (!chain.includes(parentId)) chain.push(parentId);

  return {
    inReplyTo: `<${parentId}>`,
    referencesHeader: chain.map((id) => `<${id}>`).join(" "),
    subject,
    startsNewThread: false,
  };
}

/**
 * "Re: " exactly once. A thread five replies deep must not accumulate a wall of
 * prefixes, and the check is case-insensitive because clients disagree.
 */
export function replySubject(original: string | null): string {
  const base = (original ?? "").trim();
  if (!base) return "Re:";
  return /^re\s*:/i.test(base) ? base.slice(0, MAX_SUBJECT) : `Re: ${base}`.slice(0, MAX_SUBJECT);
}

/**
 * The audience for a reply.
 *
 * `replyAll: false` — the original sender alone.
 * `replyAll: true`  — the original sender in To; everyone else the message
 *                     visibly reached in Cc.
 *
 * TWO RULES THAT ARE NOT NEGOTIABLE:
 *
 *   1. **Bcc is never reconstructed.** `ReplySource` has no bcc field at all,
 *      so it is not merely unused here — it is unreachable. A blind recipient
 *      who is exposed by a reply-all is a disclosure the platform caused.
 *   2. **The sending mailbox is removed.** Otherwise the tenant mails itself,
 *      EC-1 captures it, and it re-enters triage as apparent customer mail.
 */
export function buildReplyAudience(
  source: ReplySource,
  senderAddress: string,
  replyAll: boolean,
): { to: string[]; cc: string[] } {
  const senderKey = key(senderAddress);
  const to = [source.fromAddress].filter((a) => a && key(a) !== senderKey);

  if (!replyAll) return { to, cc: [] };

  const seen = new Set(to.map(key));
  seen.add(senderKey);
  const cc: string[] = [];
  // Only fields the original message shows openly. `bccAddresses` does not
  // exist on ReplySource — see rule 1.
  for (const a of [...source.toAddresses, ...source.ccAddresses]) {
    if (!a || typeof a !== "string") continue;
    const k = key(a);
    if (seen.has(k)) continue;
    seen.add(k);
    cc.push(a);
  }
  return { to, cc };
}

/**
 * The idempotency key for one send intent.
 *
 * Derived from the message row id, because that row IS the intent: a retry of a
 * failed send reuses the same row and therefore the same key, while a genuinely
 * new message gets a new row. That gives the property RATIFY-EMP3-1 asks for —
 * "retry preserves stable message and idempotency identity" — without asking
 * the UI to generate or remember anything.
 *
 * It is not a nonce. A nonce would make every retry look like a new message to
 * the provider, which is the opposite of what is wanted.
 */
export function idempotencyKeyFor(messageRowId: string): string {
  return `msg:${messageRowId}`;
}

/** Attachment references. Ids into the EXISTING model — never bytes or paths. */
export type AttachmentRef = {
  source: "document" | "ec_attachment";
  id: string;
  filename: string;
};

export const MAX_ATTACHMENTS = 10;

export function validateAttachmentRefs(
  refs: readonly AttachmentRef[],
): { ok: true } | { ok: false; problem: "too_many" | "bad_source" | "bad_filename" } {
  if (refs.length > MAX_ATTACHMENTS) return { ok: false, problem: "too_many" };
  for (const r of refs) {
    if (r.source !== "document" && r.source !== "ec_attachment") return { ok: false, problem: "bad_source" };
    // A filename is display text; a path separator in it is either a mistake or
    // an attempt to say something about storage layout.
    if (!r.filename || /[\r\n\0/\\]/.test(r.filename)) return { ok: false, problem: "bad_filename" };
  }
  return { ok: true };
}

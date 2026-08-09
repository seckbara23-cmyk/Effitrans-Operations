/**
 * Email provider abstraction (Phase 1.14; Resend wired in 1.18 — C3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The seam where a real ESP delivers. DARK BY DEFAULT: with no provider selected
 * it is a NO-OP/console provider ("accepts" the message, returns ok) so the full
 * queue->send->status path works without an external dependency.
 *
 * Going live is two env vars, no code change and no new dependency:
 *   COMMUNICATIONS_EMAIL_PROVIDER=resend
 *   RESEND_API_KEY=re_...                (Resend dashboard)
 *   COMMUNICATIONS_EMAIL_FROM="Effitrans <ops@your-domain>"  (verified sender)
 * Resend delivery uses its plain HTTPS API via fetch (no SDK). SMTP remains a
 * documented-but-unimplemented option (it would need a mailer dependency).
 */
import "server-only";

export type OutboundEmail = {
  to: string;
  toName: string | null;
  subject: string;
  html: string;
  text: string;
  /**
   * EMP-5D — where a human's reply should land. Resolved SERVER-SIDE from the
   * message's mailbox of record (see lib/comms/reply-to.ts); never taken from
   * request input. Omitted when there is no trustworthy mailbox, which
   * reproduces the previous behaviour exactly.
   *
   * This does NOT change the visible From, the envelope From / Return-Path, or
   * the DKIM signing domain. Those are four different things and only this one
   * moves in this phase.
   */
  replyTo?: string | null;
  /**
   * UAT-2B — optional file attachments. Added for the official invoice, which
   * customers expect to receive as a PDF rather than a link. Optional and
   * additive: every existing caller is unaffected.
   *
   * `contentBase64` is the EXACT stored artifact, read from the private bucket
   * and never re-rendered.
   */
  attachments?: readonly { filename: string; contentBase64: string }[];
};

export type SendResult = {
  ok: boolean;
  error?: string;
  /**
   * WHICH provider accepted. EMP-3 (RATIFY-EMP3-2) turns on this field: only a
   * real provider's acceptance may mark a message SENT or emit
   * CORRESPONDENCE_SENT, so "did it succeed" is not enough — the caller has to
   * know who said so. Absent on failure.
   */
  provider?: "resend" | "smtp";
  /** The provider's own identifier for the message, when it returns one. */
  providerMessageId?: string | null;
};

/** A real provider has been SELECTED (it may still be missing credentials). */
export function isProviderConfigured(): boolean {
  const p = process.env.COMMUNICATIONS_EMAIL_PROVIDER;
  return p === "smtp" || p === "resend";
}

function resendConfig(): { apiKey: string | null; from: string | null } {
  return {
    apiKey: process.env.RESEND_API_KEY?.trim() || null,
    from: process.env.COMMUNICATIONS_EMAIL_FROM?.trim() || null,
  };
}

/** Max length of the stored/logged sanitized Resend error string. */
const RESEND_ERROR_MAX = 500;

/**
 * Turn a non-2xx Resend response into a sanitized, length-capped diagnostic
 * string of the form `resend_http_<status>:<reason>`. PURE — unit-tested
 * without network. SAFE: it only ever sees the response BODY (which carries no
 * credentials — the API key lives in the request headers, never the response),
 * and it still defensively redacts any token-shaped substring. Falls back to the
 * bare `resend_http_<status>` when no usable reason can be extracted.
 */
export function sanitizeResendError(status: number, body: string): string {
  const prefix = `resend_http_${status}`;
  let reason = "";
  try {
    // Resend errors are JSON like { "statusCode": 403, "name": "...", "message": "..." }.
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown; name?: unknown };
    reason =
      (typeof parsed.message === "string" && parsed.message) ||
      (typeof parsed.error === "string" && parsed.error) ||
      (typeof parsed.name === "string" && parsed.name) ||
      "";
  } catch {
    // Non-JSON body (HTML error page, plain text) — use it as-is, sanitized below.
    reason = body;
  }
  reason = reason
    .replace(/\s+/g, " ") // collapse newlines/whitespace into single spaces
    .replace(/re_[A-Za-z0-9_-]+/g, "[redacted]") // never leak a Resend API key
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]") // nor an auth header
    .trim();
  if (!reason) return prefix;
  return `${prefix}:${reason}`.slice(0, RESEND_ERROR_MAX);
}

/**
 * Extract ONLY the domain from a sender string for safe diagnostics. PURE.
 * Handles both `"Name <user@domain>"` and bare `"user@domain"`. Returns the
 * domain (lowercased) or null — never the local-part, never the display name.
 */
export function senderDomain(from: string | null | undefined): string | null {
  if (!from) return null;
  const m = from.match(/@([^>\s]+)/);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Production guard. The `resend.dev` testing sender can only deliver to the
 * Resend account owner, so in production it silently breaks every real
 * recipient. Refuse it outright in production; ALLOW it in dev/test/local where
 * it's a legitimate convenience. PURE — the decision is driven entirely by the
 * passed nodeEnv, so it is unit-tested without touching process.env or network.
 */
export function isTestingSenderBlocked(
  from: string | null | undefined,
  nodeEnv: string | undefined,
): boolean {
  if (nodeEnv !== "production") return false;
  const domain = senderDomain(from);
  return domain === "resend.dev" || (domain?.endsWith(".resend.dev") ?? false);
}

/** Build the Resend `POST /emails` body. PURE — unit-tested without network. */
export function buildResendPayload(
  email: OutboundEmail,
  from: string,
): {
  from: string; to: string[]; subject: string; html: string; text: string;
  reply_to?: string; attachments?: { filename: string; content: string }[];
} {
  return {
    from,
    to: [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    // Omitted entirely when absent, so the payload stays byte-identical to
    // before for every caller that has no mailbox of record.
    ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    // Omitted entirely when there are none, so the payload is byte-identical
    // to before for every existing caller.
    ...(email.attachments && email.attachments.length > 0
      ? { attachments: email.attachments.map((a) => ({ filename: a.filename, content: a.contentBase64 })) }
      : {}),
  };
}

export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  const provider = process.env.COMMUNICATIONS_EMAIL_PROVIDER;

  if (provider !== "smtp" && provider !== "resend") {
    // EMP-3 / RATIFY-EMP3-2 — FAIL CLOSED.
    //
    // This used to return { ok: true }: the stub "accepted" the message, the row
    // was marked SENT, and nothing left the building. That was a lie told to
    // every caller and, once EMP-3 added a ledger event, it would have become a
    // lie told to the Decision Plane — the platform would have asserted it wrote
    // to a customer who was never written to.
    //
    // An unconfigured provider is now an explicit failure. A message that did
    // not go anywhere is FAILED, no event is emitted, and the user is told.
    if (process.env.COMMUNICATIONS_EMAIL_DEBUG === "true") {
      console.info(`[comms] (not configured) refused to send "${email.subject}"`);
    }
    return { ok: false, error: "provider_not_configured" };
  }

  if (provider === "resend") {
    const { apiKey, from } = resendConfig();
    // TEMP DIAGNOSTIC (Phase 2.5 email-failure probe): proves which sender the
    // runtime actually resolves. Domain-only — no API key, header, or payload.
    // Remove once COMMUNICATIONS_EMAIL_FROM is confirmed correct in production.
    console.info(
      `[observe] ${JSON.stringify({
        scope: "comms",
        event: "comms.resend_sender",
        provider: process.env.COMMUNICATIONS_EMAIL_PROVIDER,
        fromConfigured: !!process.env.COMMUNICATIONS_EMAIL_FROM,
        fromValueDomain: senderDomain(from),
      })}`,
    );
    if (!apiKey || !from) return { ok: false, error: "resend_not_configured" };
    // Production guard: never let the resend.dev testing sender reach real
    // recipients (it can only deliver to the account owner). Fails loudly
    // instead of silently mis-sending. Allowed in dev/test/local.
    if (isTestingSenderBlocked(from, process.env.NODE_ENV)) {
      return { ok: false, error: "resend_testing_sender_blocked" };
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildResendPayload(email, from)),
      });
      if (!res.ok) {
        // Capture the response body so the failure reason survives in last_error /
        // logs. Sanitized + length-capped; reading it never changes the outcome.
        const body = await res.text().catch(() => "");
        return { ok: false, error: sanitizeResendError(res.status, body) };
      }
      // Resend returns { id }. It is the only external handle we will ever have
      // on this message, so it is captured as evidence. A parse failure does not
      // undo an acceptance that already happened — the send still succeeded.
      let providerMessageId: string | null = null;
      try {
        const body = (await res.json()) as { id?: unknown };
        if (typeof body?.id === "string") providerMessageId = body.id;
      } catch {
        providerMessageId = null;
      }
      return { ok: true, provider: "resend", providerMessageId };
    } catch {
      return { ok: false, error: "resend_network_error" };
    }
  }

  // SMTP: needs a mailer dependency — documented, not implemented this phase.
  return { ok: false, error: "provider_not_implemented" };
}

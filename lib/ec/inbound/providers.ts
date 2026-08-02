import "server-only";

/**
 * EC-1 — inbound provider registry + adapters. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Mirrors lib/finance/providers/index.ts: the pipeline resolves a provider by
 * name and never imports a concrete adapter, so adding a real one later is a
 * one-line registry change.
 *
 * WHY "GENERIC" IS THE ONE THAT WORKS. EC-0 left the provider choice open
 * (DEC-EC-D2, still unratified). Hardcoding one vendor's exact payload shape
 * before that decision would be inventing a contract we have not read. So EC-1
 * ships GENERIC — a documented envelope, HMAC-SHA256 over the raw body, which
 * any mail-forwarding service or our own relay can satisfy — and leaves RESEND
 * as an explicit `not_configured` stub. This is exactly how payments shipped:
 * MockProvider worked; Wave and Orange Money stayed not_configured until their
 * credentials and payload contracts landed.
 *
 * Signature verification reuses lib/finance/providers/sign.ts unchanged — the
 * timing-safe HMAC helper already exists and is already tested.
 */
import { verifyHmacSignature } from "@/lib/finance/providers/sign";
import {
  InboundProviderError,
  type InboundEmail,
  type InboundEmailProvider,
  type InboundProviderName,
} from "./types";
import {
  extractDisplayName, normalizeAddress, normalizeAddressList, deriveThreadKey,
} from "./parse";

/** Header carrying the hex HMAC-SHA256 of the raw body. */
export const SIGNATURE_HEADER = "x-ec-signature";

export function inboundEnabled(): boolean {
  return process.env.EFFITRANS_EC_INBOUND_ENABLED === "true";
}

export function genericWebhookSecret(): string | null {
  return process.env.EC_INBOUND_WEBHOOK_SECRET?.trim() || null;
}

/**
 * The GENERIC envelope. Documented here because it IS the contract:
 *
 * {
 *   "event_id":   "evt_01H...",           // required — idempotency anchor
 *   "message_id": "<abc@mail.example>",   // RFC-5322 Message-ID
 *   "in_reply_to": "<xyz@mail.example>",
 *   "references": "<a@x> <b@x>",
 *   "from":       "\"Awa\" <awa@client.sn>",
 *   "to":         ["quotation@tenant.sn"],
 *   "cc":         [],
 *   "subject":    "Demande de cotation",
 *   "received_at": "2026-08-04T09:12:00Z",
 *   "headers":    { "Return-Path": "..." },
 *   "text":       "...",
 *   "html":       "<p>...</p>",
 *   "attachments":[{ "filename":"bl.pdf","content_type":"application/pdf","content":"<base64>" }]
 * }
 */
type GenericPayload = {
  event_id?: unknown; message_id?: unknown; in_reply_to?: unknown; references?: unknown;
  from?: unknown; to?: unknown; cc?: unknown; subject?: unknown; received_at?: unknown;
  headers?: unknown; text?: unknown; html?: unknown; attachments?: unknown;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const GenericProvider: InboundEmailProvider = {
  name: "GENERIC",
  async parseWebhook(rawBody, headers): Promise<InboundEmail> {
    const secret = genericWebhookSecret();
    if (!secret) throw new InboundProviderError("not_configured", "EC_INBOUND_WEBHOOK_SECRET is unset");

    let payload: GenericPayload;
    try {
      payload = JSON.parse(rawBody) as GenericPayload;
    } catch {
      throw new InboundProviderError("bad_payload", "body is not JSON");
    }

    const eventId = str(payload.event_id);
    const from = normalizeAddress(str(payload.from));
    // An envelope with no event id or no usable sender cannot be reasoned about.
    if (!eventId) throw new InboundProviderError("bad_payload", "event_id missing");
    if (!from) throw new InboundProviderError("bad_payload", "from missing or malformed");

    const signature = headers[SIGNATURE_HEADER] ?? "";
    // Verified over the RAW body, before any interpretation of its contents.
    const signatureValid = Boolean(signature) && verifyHmacSignature(secret, rawBody, signature);

    const messageId = str(payload.message_id);
    const inReplyTo = str(payload.in_reply_to);
    const referencesHeader = str(payload.references);

    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments.flatMap((a) => {
          if (!a || typeof a !== "object") return [];
          const part = a as { filename?: unknown; content_type?: unknown; content?: unknown };
          const content = str(part.content);
          if (!content) return [];
          return [{
            filename: str(part.filename) ?? "piece-jointe",
            mimeType: str(part.content_type),
            contentBase64: content,
          }];
        })
      : [];

    const rawHeaders =
      payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)
        ? Object.fromEntries(
            Object.entries(payload.headers as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k.toLowerCase(), String(v).slice(0, 1000)]),
          )
        : {};

    return {
      eventId,
      providerMessageId: messageId,
      messageId,
      inReplyTo,
      referencesHeader,
      fromAddress: from,
      fromName: extractDisplayName(str(payload.from)),
      toAddresses: normalizeAddressList(strList(payload.to)),
      ccAddresses: normalizeAddressList(strList(payload.cc)),
      subject: str(payload.subject)?.slice(0, 500) ?? null,
      receivedAt: str(payload.received_at),
      headers: rawHeaders,
      textBody: typeof payload.text === "string" ? payload.text : null,
      htmlBody: typeof payload.html === "string" ? payload.html : null,
      attachments,
      rawEnvelope: rawBody,
      signatureValid,
      // threadKey is derived by the pipeline via deriveThreadKey — kept out of
      // the adapter so every provider gets identical threading semantics.
    } satisfies InboundEmail;
  },
};

/**
 * RESEND — deliberately NOT implemented. DEC-EC-D2 (provider choice + DPA) is
 * open; writing a payload mapping for a contract nobody has ratified would be
 * guesswork wearing the costume of progress. Reports not_configured, exactly as
 * WaveProvider did before its credentials landed.
 */
const ResendProvider: InboundEmailProvider = {
  name: "RESEND",
  async parseWebhook(): Promise<InboundEmail> {
    throw new InboundProviderError("not_configured", "Resend inbound awaits DEC-EC-D2");
  },
};

const REGISTRY: Record<InboundProviderName, InboundEmailProvider> = {
  GENERIC: GenericProvider,
  RESEND: ResendProvider,
};

export function getInboundProvider(name: InboundProviderName): InboundEmailProvider {
  const provider = REGISTRY[name];
  if (!provider) throw new InboundProviderError("unknown_provider", `No inbound provider for "${name}".`);
  return provider;
}

export { deriveThreadKey };

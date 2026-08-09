/**
 * EC-1 — inbound email provider abstraction. PURE (no I/O, client+server safe).
 * ---------------------------------------------------------------------------
 * One interface so any mail provider is interchangeable and the capture
 * pipeline never branches on a provider name — the same shape
 * lib/finance/providers/types.ts uses for payments, for the same reason.
 *
 * NOTE ON PROSE: `InboundEmail` carries body text because the ADAPTER must hand
 * it to the pipeline, which writes it straight to private storage. It is never
 * persisted to a column, never logged, never audited and never returned to a
 * caller. Everything downstream of `captureInbound` speaks in paths and hashes.
 */

/** Providers EC-1 knows about. GENERIC is the documented, working one. */
export const INBOUND_PROVIDERS = ["GENERIC", "RESEND"] as const;
export type InboundProviderName = (typeof INBOUND_PROVIDERS)[number];

export function isInboundProviderName(v: string): v is InboundProviderName {
  return (INBOUND_PROVIDERS as readonly string[]).includes(v);
}

export type InboundAttachmentPart = {
  filename: string;
  mimeType: string | null;
  /** base64 of the part's bytes. Consumed by the pipeline, never persisted raw. */
  contentBase64: string;
};

/** One inbound email, normalized. Every provider maps its payload into this. */
export type InboundEmail = {
  /** provider's delivery/event id — THE idempotency anchor */
  eventId: string;
  /** provider's own message id, if distinct from the RFC-5322 Message-ID */
  providerMessageId: string | null;
  /** RFC 5322 Message-ID header */
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  /** ISO. Null means the pipeline stamps arrival time. */
  receivedAt: string | null;
  /** Normalized header map — names and values only. */
  headers: Record<string, string>;
  textBody: string | null;
  htmlBody: string | null;
  attachments: InboundAttachmentPart[];
  /** The exact bytes the provider posted — hashed and stored as evidence. */
  rawEnvelope: string;
  /** Result of signature verification over the RAW body. */
  signatureValid: boolean;
};

export type InboundProviderErrorCode =
  | "not_configured"
  | "bad_payload"
  | "payload_too_large"
  | "unknown_provider";

export class InboundProviderError extends Error {
  code: InboundProviderErrorCode;
  constructor(code: InboundProviderErrorCode, message?: string) {
    super(message ?? code);
    this.name = "InboundProviderError";
    this.code = code;
  }
}

export interface InboundEmailProvider {
  readonly name: InboundProviderName;
  /**
   * Verify the signature over `rawBody` and normalize the payload.
   * MUST NOT throw for an invalid signature — it returns
   * `signatureValid: false` so the caller can log the refusal. It throws only
   * when the payload cannot be understood at all.
   */
  parseWebhook(rawBody: string, headers: Record<string, string>): Promise<InboundEmail>;
}

/** Why a captured message could not be routed to a tenant. */
export type QuarantineReason =
  | "no_matching_mailbox"
  | "ambiguous_routing"
  | "tenant_not_enabled"
  | "mailbox_inactive"
  /** EMP-5G — matched an in-service mailbox that is not runtime-verified for
   *  inbound: unproven, stale, legacy-active or of unestablished provenance.
   *  Kept distinct from `mailbox_inactive` because the two need different
   *  fixes, and an administrator reading quarantine deserves to know which. */
  | "mailbox_not_verified"
  | "payload_too_large"
  | "malformed_envelope";

export type CaptureOutcome = "CAPTURED" | "DUPLICATE" | "QUARANTINED" | "REJECTED" | "ERROR";

export type CaptureResult = {
  httpStatus: number;
  outcome: CaptureOutcome;
  /** Short classification. NEVER a subject, body, address or filename. */
  detail?: string;
};

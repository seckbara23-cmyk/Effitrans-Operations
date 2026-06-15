/**
 * Payment-provider abstraction types (Phase 1.15B). Client + server safe (no I/O).
 * ---------------------------------------------------------------------------
 * One interface so Wave / Orange Money / Mock are interchangeable and the
 * service layer never branches on provider name. Real network calls live in the
 * server-only implementations; these are just the contracts.
 */
import type { ProviderName } from "../payment-intent";

export type ProviderCapabilities = {
  /** hosted redirect checkout page (Wave) */
  checkoutUrl: boolean;
  /** STK/USSD push to the payer's phone (Orange Money) */
  pushPayment: boolean;
  webhooks: boolean;
  statusPolling: boolean;
  /** MVP: false for every provider (DEC-B24 Q3) */
  partialPayments: boolean;
  /** MVP: false for every provider */
  refunds: boolean;
};

export type CheckoutInput = {
  /** our payment_intent.id — providers echo it back so we can correlate */
  intentId: string;
  amount: number;
  currency: string;
  invoiceNumber: string | null;
  returnUrl?: string | null;
};

export type ProviderCheckout = {
  providerIntentId: string;
  checkoutUrl: string | null;
  /** ISO; null means the caller applies the configured TTL */
  expiresAt: string | null;
};

/** Normalized webhook event — every provider maps its payload into this shape. */
export type ProviderEventKind = "SUCCESS" | "FAILURE" | "PENDING" | "UNKNOWN";

export type ProviderEvent = {
  /** provider's event id — the idempotency / replay anchor */
  eventId: string;
  /** provider's raw event type string (stored for audit) */
  eventType: string;
  kind: ProviderEventKind;
  providerIntentId: string | null;
  providerReference: string | null;
  amount: number | null;
  currency: string | null;
  /** ISO timestamp from the provider — used for replay-skew rejection */
  occurredAt: string | null;
  /** result of HMAC/signature verification over the raw body */
  signatureValid: boolean;
};

export type ProviderStatus = {
  kind: ProviderEventKind;
  providerReference: string | null;
};

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;
  createCheckout(input: CheckoutInput): Promise<ProviderCheckout>;
  parseWebhook(rawBody: string, headers: Record<string, string>): Promise<ProviderEvent>;
  getIntentStatus(providerIntentId: string): Promise<ProviderStatus>;
}

/** Thrown by providers; `code` is surfaced to the action layer as the error key. */
export class ProviderError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "ProviderError";
    this.code = code;
  }
}

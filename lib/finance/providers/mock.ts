/**
 * Mock payment provider (Phase 1.15B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The dev/test default — the ONLY provider that moves an intent end-to-end in
 * 1.15B (mirrors the 1.14 no-op comms provider). It issues a deterministic
 * provider intent id + a local fake checkout URL, and verifies an HMAC-signed
 * webhook against PAYMENTS_MOCK_WEBHOOK_SECRET. No external network calls.
 *
 * Expected webhook body (JSON), signed in header `x-mock-signature` (hex HMAC):
 *   { "eventId": "...", "type": "payment.success|payment.failed",
 *     "providerIntentId": "...", "amount": 123.45, "currency": "XOF",
 *     "occurredAt": "2026-06-15T..." }
 */
import "server-only";
import { mockWebhookSecret } from "./config";
import { verifyHmacSignature } from "./sign";
import {
  ProviderError,
  type CheckoutInput,
  type PaymentProvider,
  type ProviderCheckout,
  type ProviderEvent,
  type ProviderEventKind,
  type ProviderStatus,
} from "./types";

function kindFromType(type: string): ProviderEventKind {
  if (type === "payment.success" || type === "payment.succeeded") return "SUCCESS";
  if (type === "payment.failed" || type === "payment.failure") return "FAILURE";
  if (type === "payment.pending" || type === "payment.processing") return "PENDING";
  return "UNKNOWN";
}

export const MockProvider: PaymentProvider = {
  name: "MOCK",
  capabilities: {
    checkoutUrl: true,
    pushPayment: false,
    webhooks: true,
    statusPolling: false,
    partialPayments: false,
    refunds: false,
  },

  async createCheckout(input: CheckoutInput): Promise<ProviderCheckout> {
    if (!mockWebhookSecret()) throw new ProviderError("not_configured");
    // Deterministic id so the dev webhook helper can target it.
    return {
      providerIntentId: `mock_${input.intentId}`,
      checkoutUrl: `/finance/mock-pay/${input.intentId}`,
      expiresAt: null, // caller applies the configured TTL
    };
  },

  async parseWebhook(rawBody: string, headers: Record<string, string>): Promise<ProviderEvent> {
    const secret = mockWebhookSecret();
    if (!secret) throw new ProviderError("not_configured");

    const signature = headers["x-mock-signature"] ?? "";
    const signatureValid = verifyHmacSignature(secret, rawBody, signature);

    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new ProviderError("bad_payload");
    }

    const type = String(body.type ?? "");
    const amount = body.amount != null ? Number(body.amount) : null;
    return {
      eventId: String(body.eventId ?? ""),
      eventType: type,
      kind: kindFromType(type),
      providerIntentId: body.providerIntentId != null ? String(body.providerIntentId) : null,
      providerReference: body.providerReference != null ? String(body.providerReference) : null,
      amount: amount != null && Number.isFinite(amount) ? amount : null,
      currency: body.currency != null ? String(body.currency) : null,
      occurredAt: body.occurredAt != null ? String(body.occurredAt) : null,
      signatureValid,
    };
  },

  async getIntentStatus(): Promise<ProviderStatus> {
    // The mock has no server-side state to poll; the webhook is the source of truth.
    return { kind: "UNKNOWN", providerReference: null };
  },
};

/**
 * Orange Money payment provider — PLACEHOLDER (Phase 1.15B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Interface implemented; NO real network calls in 1.15B. Every method throws
 * `not_configured` until Orange Money API credentials + the real API contract
 * are approved (DEC-B24 Q1: Orange Money after Wave). When implemented:
 *   - createCheckout → OAuth token → Web Payment / USSD push → payment URL
 *   - parseWebhook   → verify provider signature over the raw body
 *   - getIntentStatus→ GET transaction status
 */
import "server-only";
import { ProviderError, type PaymentProvider } from "./types";

export const OrangeMoneyProvider: PaymentProvider = {
  name: "ORANGE_MONEY",
  capabilities: {
    checkoutUrl: true,
    pushPayment: true,
    webhooks: true,
    statusPolling: true,
    partialPayments: false,
    refunds: false,
  },
  async createCheckout() {
    throw new ProviderError("not_configured", "Orange Money provider not configured (deferred to credentials).");
  },
  async parseWebhook() {
    throw new ProviderError("not_configured", "Orange Money provider not configured (deferred to credentials).");
  },
  async getIntentStatus() {
    throw new ProviderError("not_configured", "Orange Money provider not configured (deferred to credentials).");
  },
};

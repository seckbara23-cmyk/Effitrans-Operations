/**
 * Wave payment provider — PLACEHOLDER (Phase 1.15B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Interface implemented; NO real network calls in 1.15B. Every method throws
 * `not_configured` until Wave API credentials + the real API contract are
 * approved (DEC-B24 Q1: Wave first when credentials land). When implemented:
 *   - createCheckout → POST Wave Checkout Sessions → { id, wave_launch_url }
 *   - parseWebhook   → verify `Wave-Signature` HMAC over the raw body
 *   - getIntentStatus→ GET checkout session status
 */
import "server-only";
import { ProviderError, type PaymentProvider } from "./types";

export const WaveProvider: PaymentProvider = {
  name: "WAVE",
  capabilities: {
    checkoutUrl: true,
    pushPayment: false,
    webhooks: true,
    statusPolling: true,
    partialPayments: false,
    refunds: false,
  },
  async createCheckout() {
    throw new ProviderError("not_configured", "Wave provider not configured (deferred to credentials).");
  },
  async parseWebhook() {
    throw new ProviderError("not_configured", "Wave provider not configured (deferred to credentials).");
  },
  async getIntentStatus() {
    throw new ProviderError("not_configured", "Wave provider not configured (deferred to credentials).");
  },
};

import { describe, it, expect } from "vitest";
import {
  INTENT_STATUSES,
  PROVIDERS,
  amountMatches,
  canCancel,
  canTransition,
  isExpired,
  isIntentStatus,
  isProviderName,
  isTerminal,
} from "@/lib/finance/payment-intent";
import { hmacSha256Hex, verifyHmacSignature } from "@/lib/finance/providers/sign";
import { MockProvider } from "@/lib/finance/providers/mock";

describe("payment-intent state machine (1.15B)", () => {
  it("status + provider guards", () => {
    for (const s of INTENT_STATUSES) expect(isIntentStatus(s)).toBe(true);
    expect(isIntentStatus("REFUNDED")).toBe(false);
    for (const p of PROVIDERS) expect(isProviderName(p)).toBe(true);
    expect(isProviderName("PAYPAL")).toBe(false);
  });

  it("terminal + cancel", () => {
    expect(isTerminal("SUCCEEDED")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
    expect(isTerminal("PENDING")).toBe(false);
    expect(canCancel("PENDING")).toBe(true);
    expect(canCancel("CREATED")).toBe(true);
    expect(canCancel("SUCCEEDED")).toBe(false);
    expect(canCancel("CANCELLED")).toBe(false);
  });

  it("transitions are monotonic; terminals are frozen", () => {
    expect(canTransition("CREATED", "PENDING")).toBe(true);
    expect(canTransition("PENDING", "SUCCEEDED")).toBe(true);
    expect(canTransition("PROCESSING", "FAILED")).toBe(true);
    expect(canTransition("SUCCEEDED", "FAILED")).toBe(false);
    expect(canTransition("CANCELLED", "PENDING")).toBe(false);
    expect(canTransition("FAILED", "SUCCEEDED")).toBe(false);
  });

  it("amount match = full balance only (no partials)", () => {
    expect(amountMatches(1000, 1000)).toBe(true);
    expect(amountMatches(1000.004, 1000)).toBe(true); // sub-cent epsilon
    expect(amountMatches(999.99, 1000)).toBe(false);
    expect(amountMatches(500, 1000)).toBe(false); // partial rejected
  });

  it("expiry only applies to open intents with a TTL", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    expect(isExpired("PENDING", "2026-06-15T11:00:00Z", now)).toBe(true);
    expect(isExpired("PENDING", "2026-06-15T13:00:00Z", now)).toBe(false);
    expect(isExpired("SUCCEEDED", "2026-06-15T11:00:00Z", now)).toBe(false);
    expect(isExpired("PENDING", null, now)).toBe(false);
  });
});

describe("webhook signature (1.15B)", () => {
  it("HMAC round-trip verifies, tampering fails", () => {
    const secret = "test_secret";
    const body = '{"eventId":"e1","type":"payment.success"}';
    const sig = hmacSha256Hex(secret, body);
    expect(verifyHmacSignature(secret, body, sig)).toBe(true);
    expect(verifyHmacSignature(secret, body + " ", sig)).toBe(false);
    expect(verifyHmacSignature("wrong", body, sig)).toBe(false);
    expect(verifyHmacSignature(secret, body, "deadbeef")).toBe(false);
  });
});

describe("MockProvider (1.15B)", () => {
  it("createCheckout is deterministic + parseWebhook validates signature", async () => {
    process.env.PAYMENTS_MOCK_WEBHOOK_SECRET = "mock_secret";

    const checkout = await MockProvider.createCheckout({
      intentId: "intent-123",
      amount: 1000,
      currency: "XOF",
      invoiceNumber: "EFT-INV-2026-00001",
    });
    expect(checkout.providerIntentId).toBe("mock_intent-123");
    expect(checkout.checkoutUrl).toContain("intent-123");

    const body = JSON.stringify({
      eventId: "evt-1",
      type: "payment.success",
      providerIntentId: "mock_intent-123",
      amount: 1000,
      currency: "XOF",
      occurredAt: "2026-06-15T12:00:00Z",
    });
    const sig = hmacSha256Hex("mock_secret", body);

    const valid = await MockProvider.parseWebhook(body, { "x-mock-signature": sig });
    expect(valid.signatureValid).toBe(true);
    expect(valid.kind).toBe("SUCCESS");
    expect(valid.providerIntentId).toBe("mock_intent-123");
    expect(valid.amount).toBe(1000);

    const bad = await MockProvider.parseWebhook(body, { "x-mock-signature": "00" });
    expect(bad.signatureValid).toBe(false);
  });
});

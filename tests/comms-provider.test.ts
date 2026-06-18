import { describe, it, expect } from "vitest";
import {
  buildResendPayload,
  isProviderConfigured,
  isTestingSenderBlocked,
  sanitizeResendError,
  senderDomain,
} from "@/lib/comms/provider";

describe("comms provider (Phase 1.18 — C3 Resend wiring)", () => {
  it("builds a Resend payload from an outbound email", () => {
    const payload = buildResendPayload(
      { to: "client@example.com", toName: "Client", subject: "Hello", html: "<p>Hi</p>", text: "Hi" },
      "Effitrans <ops@effitrans.test>",
    );
    expect(payload).toEqual({
      from: "Effitrans <ops@effitrans.test>",
      to: ["client@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });

  it("reports a provider configured only when one is selected", () => {
    const prev = process.env.COMMUNICATIONS_EMAIL_PROVIDER;
    try {
      delete process.env.COMMUNICATIONS_EMAIL_PROVIDER;
      expect(isProviderConfigured()).toBe(false);
      process.env.COMMUNICATIONS_EMAIL_PROVIDER = "resend";
      expect(isProviderConfigured()).toBe(true);
      process.env.COMMUNICATIONS_EMAIL_PROVIDER = "smtp";
      expect(isProviderConfigured()).toBe(true);
      process.env.COMMUNICATIONS_EMAIL_PROVIDER = "";
      expect(isProviderConfigured()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.COMMUNICATIONS_EMAIL_PROVIDER;
      else process.env.COMMUNICATIONS_EMAIL_PROVIDER = prev;
    }
  });

  describe("senderDomain (safe diagnostic extraction)", () => {
    it("extracts the domain from a 'Name <user@domain>' sender", () => {
      expect(senderDomain("Effitrans Operations <onboarding@resend.dev>")).toBe("resend.dev");
    });

    it("extracts the domain from a bare address and lowercases it", () => {
      expect(senderDomain("Ops@Effitrans.SN")).toBe("effitrans.sn");
    });

    it("returns null for missing/empty/malformed senders (no domain leaked)", () => {
      expect(senderDomain(null)).toBeNull();
      expect(senderDomain("")).toBeNull();
      expect(senderDomain("not-an-email")).toBeNull();
    });
  });

  describe("isTestingSenderBlocked (production resend.dev guard)", () => {
    const resendDevSender = "Effitrans Operations <onboarding@resend.dev>";
    const verifiedSender = "Effitrans Operations <ops@effitrans.sn>";

    it("blocks a resend.dev sender in production", () => {
      expect(isTestingSenderBlocked(resendDevSender, "production")).toBe(true);
    });

    it("allows a verified-domain sender in production", () => {
      expect(isTestingSenderBlocked(verifiedSender, "production")).toBe(false);
    });

    it("allows a resend.dev sender in development", () => {
      expect(isTestingSenderBlocked(resendDevSender, "development")).toBe(false);
    });

    it("allows a resend.dev sender in test / when env is unset", () => {
      expect(isTestingSenderBlocked(resendDevSender, "test")).toBe(false);
      expect(isTestingSenderBlocked(resendDevSender, undefined)).toBe(false);
    });

    it("also blocks resend.dev subdomains in production", () => {
      expect(isTestingSenderBlocked("X <bounce@mail.resend.dev>", "production")).toBe(true);
    });
  });

  describe("sanitizeResendError (non-2xx body capture)", () => {
    it("extracts the message from a structured Resend JSON error", () => {
      const body = JSON.stringify({
        statusCode: 403,
        name: "validation_error",
        message: "The aminata@effitrans.com domain is not verified.",
      });
      expect(sanitizeResendError(403, body)).toBe(
        "resend_http_403:The aminata@effitrans.com domain is not verified.",
      );
    });

    it("collapses newlines/whitespace in non-JSON bodies", () => {
      expect(sanitizeResendError(502, "Bad\n  Gateway\n")).toBe("resend_http_502:Bad Gateway");
    });

    it("falls back to the bare status when no reason can be extracted", () => {
      expect(sanitizeResendError(403, "")).toBe("resend_http_403");
      expect(sanitizeResendError(403, "{}")).toBe("resend_http_403");
    });

    it("redacts API-key- and Bearer-token-shaped substrings", () => {
      const body = JSON.stringify({ message: "bad key re_abc123DEF_456 via Bearer sk_live_xyz.789" });
      const out = sanitizeResendError(401, body);
      expect(out).not.toContain("re_abc123DEF_456");
      expect(out).toContain("[redacted]");
      expect(out).toContain("Bearer [redacted]");
    });

    it("caps the stored error length at 500 chars", () => {
      const body = JSON.stringify({ message: "x".repeat(1000) });
      const out = sanitizeResendError(403, body);
      expect(out.length).toBe(500);
      expect(out.startsWith("resend_http_403:")).toBe(true);
    });
  });
});

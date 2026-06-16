import { describe, it, expect } from "vitest";
import { buildResendPayload, isProviderConfigured } from "@/lib/comms/provider";

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
});

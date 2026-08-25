/**
 * C-4 — the SMTP provider is REAL, and success means the server accepted.
 * ---------------------------------------------------------------------------
 * The alternative on the table was stubbing `sendEmail` so an automated journey
 * could reach step 22. That is exactly the lie EMP-3 / RATIFY-EMP3-2 removed,
 * and it would have destroyed the only invariant step 22 enforces: an invoice
 * becomes ISSUED because a customer was actually written to.
 *
 * So these pin the properties that make the implementation trustworthy — not
 * that it exists, but that it cannot report a success it did not have.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const smtp = read("lib/comms/smtp.ts");
const provider = read("lib/comms/provider.ts");

describe("C-4 — the SMTP branch is implemented, and implemented honestly", () => {
  it("the documented stub is gone", () => {
    expect(provider).not.toContain("provider_not_implemented");
    expect(provider).toContain("sendViaSmtp(");
  });

  it("success is reported ONLY on acceptance by the server", () => {
    // The two ways a send can silently not arrive: nobody accepted it, or the
    // recipient was rejected while the transaction still resolved.
    expect(smtp).toContain("if (accepted.length === 0 || rejected.length > 0)");
    expect(smtp).toContain('return { ok: false, error: "smtp_recipient_rejected" }');
    // …and a thrown transport error is a failure, never swallowed into success.
    expect(smtp).toContain("return { ok: false, error: classify(err) };");
  });

  it("failures are DETERMINISTIC classifications, not provider prose", () => {
    // last_error is stored and read by operators; a provider's message can
    // carry addresses, headers or body fragments. The code is what is
    // actionable, the prose is what leaks — the same rule the Resend branch has.
    for (const code of [
      "smtp_connection_refused", "smtp_connection_failed", "smtp_auth_failed",
      "smtp_envelope_rejected", "smtp_send_failed",
    ]) {
      expect(smtp, code).toContain(code);
    }
    expect(smtp).not.toMatch(/error:\s*(err|error)\.message/);
    expect(smtp).not.toMatch(/error:\s*String\((err|error)\)/);
  });

  it("there is NO test-awareness anywhere in the provider", () => {
    // If this file could tell it was under test, nothing it proved would
    // transfer to production. Asserted on CODE ONLY — the header legitimately
    // explains that CI points this provider at a disposable sink, and a
    // whole-file check fails on that prose while proving nothing.
    const code = smtp.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const smell of ["NODE_ENV", "VITEST", "journey", "test.local", "mailpit", "MAILPIT"]) {
      expect(code, smell).not.toContain(smell);
    }
    // No environment branch beyond the documented provider configuration.
    const envs = [...code.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]).sort();
    expect([...new Set(envs)]).toEqual([
      "COMMUNICATIONS_EMAIL_FROM", "SMTP_HOST", "SMTP_PASSWORD", "SMTP_PORT",
      "SMTP_REJECT_UNAUTHORIZED", "SMTP_SECURE", "SMTP_USER",
    ]);
  });

  it("naming a provider is not the same as being able to reach it", () => {
    // isProviderConfigured used to return true for `smtp` with nothing
    // configured, which moved a certain failure into the middle of a send.
    expect(provider).toContain('if (p === "smtp") return isSmtpConfigured();');
    expect(smtp).toContain("export function isSmtpConfigured()");
  });

  it("the Resend implementation is untouched", () => {
    expect(provider).toContain("https://api.resend.com/emails");
    expect(provider).toContain("resend_testing_sender_blocked");
    expect(provider).toContain('return { ok: true, provider: "resend", providerMessageId };');
  });

  it("an unconfigured provider still FAILS CLOSED", () => {
    expect(provider).toContain('return { ok: false, error: "provider_not_configured" };');
  });

  it("the governed lane still issues ONLY after acceptance", () => {
    // The invariant this whole exercise exists to keep true.
    const billing = read("lib/process/billing/actions.ts");
    const email = billing.slice(billing.indexOf("export async function emailValidatedInvoice"));
    const failed = email.indexOf('return fail("email_send_failed")');
    const issued = email.indexOf('status: "ISSUED"');
    expect(email).toContain('if (sent.status !== "SENT")');
    expect(failed).toBeGreaterThan(-1);
    expect(issued).toBeGreaterThan(failed);
    // …and the write is a CAS on VALIDATED, so it cannot re-issue.
    expect(email).toContain('.eq("status", "VALIDATED")');
  });
});

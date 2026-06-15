/**
 * Email provider abstraction (Phase 1.14). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The seam where a real ESP (SMTP / Resend) would deliver. This phase ships a
 * NO-OP/console provider: it "accepts" the message (logs when enabled) and
 * returns ok, so the full queue->send->status path works end-to-end without an
 * external dependency. A real provider is wired later, behind env + approval.
 */
import "server-only";

export type OutboundEmail = {
  to: string;
  toName: string | null;
  subject: string;
  html: string;
  text: string;
};

export type SendResult = { ok: boolean; error?: string };

/** Whether a real provider is configured (kept false until one is wired). */
export function isProviderConfigured(): boolean {
  return process.env.COMMUNICATIONS_EMAIL_PROVIDER === "smtp" || process.env.COMMUNICATIONS_EMAIL_PROVIDER === "resend";
}

export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  if (!isProviderConfigured()) {
    // No-op: the message is treated as delivered to the stub for now.
    if (process.env.COMMUNICATIONS_EMAIL_DEBUG === "true") {
      console.info(`[comms] (no-op) would send "${email.subject}" -> ${email.to}`);
    }
    return { ok: true };
  }
  // PLAN (deferred): dispatch via the configured SMTP/Resend provider here.
  return { ok: false, error: "provider_not_implemented" };
}

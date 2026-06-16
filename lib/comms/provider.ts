/**
 * Email provider abstraction (Phase 1.14; Resend wired in 1.18 — C3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The seam where a real ESP delivers. DARK BY DEFAULT: with no provider selected
 * it is a NO-OP/console provider ("accepts" the message, returns ok) so the full
 * queue->send->status path works without an external dependency.
 *
 * Going live is two env vars, no code change and no new dependency:
 *   COMMUNICATIONS_EMAIL_PROVIDER=resend
 *   RESEND_API_KEY=re_...                (Resend dashboard)
 *   COMMUNICATIONS_EMAIL_FROM="Effitrans <ops@your-domain>"  (verified sender)
 * Resend delivery uses its plain HTTPS API via fetch (no SDK). SMTP remains a
 * documented-but-unimplemented option (it would need a mailer dependency).
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

/** A real provider has been SELECTED (it may still be missing credentials). */
export function isProviderConfigured(): boolean {
  const p = process.env.COMMUNICATIONS_EMAIL_PROVIDER;
  return p === "smtp" || p === "resend";
}

function resendConfig(): { apiKey: string | null; from: string | null } {
  return {
    apiKey: process.env.RESEND_API_KEY?.trim() || null,
    from: process.env.COMMUNICATIONS_EMAIL_FROM?.trim() || null,
  };
}

/** Build the Resend `POST /emails` body. PURE — unit-tested without network. */
export function buildResendPayload(
  email: OutboundEmail,
  from: string,
): { from: string; to: string[]; subject: string; html: string; text: string; reply_to?: string } {
  return {
    from,
    to: [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
  };
}

export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  const provider = process.env.COMMUNICATIONS_EMAIL_PROVIDER;

  if (provider !== "smtp" && provider !== "resend") {
    // No-op: the message is treated as delivered to the stub for now.
    if (process.env.COMMUNICATIONS_EMAIL_DEBUG === "true") {
      console.info(`[comms] (no-op) would send "${email.subject}" -> ${email.to}`);
    }
    return { ok: true };
  }

  if (provider === "resend") {
    const { apiKey, from } = resendConfig();
    if (!apiKey || !from) return { ok: false, error: "resend_not_configured" };
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildResendPayload(email, from)),
      });
      if (!res.ok) return { ok: false, error: `resend_http_${res.status}` };
      return { ok: true };
    } catch {
      return { ok: false, error: "resend_network_error" };
    }
  }

  // SMTP: needs a mailer dependency — documented, not implemented this phase.
  return { ok: false, error: "provider_not_implemented" };
}

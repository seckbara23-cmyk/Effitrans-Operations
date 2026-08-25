import "server-only";
/**
 * SMTP delivery — a REAL provider, not a test seam.
 * ---------------------------------------------------------------------------
 * `sendEmail` has always documented an `smtp` provider and returned
 * `provider_not_implemented` for it. This implements it, on the same contract
 * as the Resend branch: it performs an actual SMTP transaction and reports
 * success ONLY when the server has accepted the message.
 *
 * WHY IT MATTERS THAT THIS IS REAL. The alternative on the table was a stub
 * returning `{ ok: true }` so an automated journey could reach step 22. That is
 * precisely the lie EMP-3 / RATIFY-EMP3-2 removed, and it would have destroyed
 * the one invariant step 22 exists to enforce: an invoice becomes ISSUED only
 * after a customer was actually written to. A test that proves issuance by
 * faking delivery proves nothing about issuance.
 *
 * So there is no C-4 conditional anywhere in this file, no "if testing", no
 * bypass. It is a supported provider that happens to be pointed at a disposable
 * sink in CI and would be pointed at a real relay in production. The Resend
 * implementation is untouched.
 *
 * CONFIGURATION (all standard, none test-specific):
 *   COMMUNICATIONS_EMAIL_PROVIDER=smtp
 *   COMMUNICATIONS_EMAIL_FROM      the visible + envelope sender
 *   SMTP_HOST, SMTP_PORT
 *   SMTP_SECURE=true               implicit TLS (465). Otherwise STARTTLS is
 *                                  used when the server offers it.
 *   SMTP_USER, SMTP_PASSWORD       optional; omitted for an unauthenticated relay
 *   SMTP_REJECT_UNAUTHORIZED=false only for a self-signed relay
 */
import nodemailer from "nodemailer";

export type SmtpSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

export type SmtpMessage = {
  to: string;
  toName: string | null;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  attachments?: readonly { filename: string; contentBase64: string }[];
};

function config() {
  return {
    host: process.env.SMTP_HOST?.trim() || null,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER?.trim() || null,
    password: process.env.SMTP_PASSWORD?.trim() || null,
    from: process.env.COMMUNICATIONS_EMAIL_FROM?.trim() || null,
    rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== "false",
  };
}

/** True when enough is configured to attempt a transaction at all. */
export function isSmtpConfigured(): boolean {
  const c = config();
  return Boolean(c.host && c.from && Number.isFinite(c.port) && c.port > 0);
}

/**
 * Sanitize a transport error into a short, stable classification.
 *
 * The same discipline the Resend branch applies: a provider's error text can
 * carry recipient addresses, headers or body fragments, and this string is
 * stored on `communication_message.last_error` and read by operators. The CODE
 * is what makes a failure actionable; the prose is what leaks.
 */
function classify(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  const response = (err as { responseCode?: number } | null)?.responseCode;
  if (code === "ECONNREFUSED") return "smtp_connection_refused";
  if (code === "ETIMEDOUT" || code === "ESOCKET") return "smtp_connection_failed";
  if (code === "EAUTH") return "smtp_auth_failed";
  if (code === "EENVELOPE") return "smtp_envelope_rejected";
  if (typeof response === "number" && response >= 500) return `smtp_rejected_${response}`;
  if (typeof response === "number" && response >= 400) return `smtp_deferred_${response}`;
  return "smtp_send_failed";
}

/**
 * Perform the SMTP transaction.
 *
 * Success requires that the server ACCEPTED the message and rejected no
 * recipient. Nodemailer resolves with `accepted`/`rejected` arrays, and a
 * partial acceptance is not an acceptance here: this platform sends one
 * recipient at a time, so a rejected address means the message did not arrive.
 */
export async function sendViaSmtp(message: SmtpMessage): Promise<SmtpSendResult> {
  const c = config();
  if (!c.host || !c.from) return { ok: false, error: "smtp_not_configured" };

  const transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    ...(c.user && c.password ? { auth: { user: c.user, pass: c.password } } : {}),
    tls: { rejectUnauthorized: c.rejectUnauthorized },
  });

  try {
    const info = await transport.sendMail({
      from: c.from,
      to: message.toName ? `"${message.toName.replace(/"/g, "")}" <${message.to}>` : message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.attachments && message.attachments.length > 0
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.contentBase64, "base64"),
            })),
          }
        : {}),
    });

    const accepted = (info.accepted ?? []) as unknown[];
    const rejected = (info.rejected ?? []) as unknown[];
    if (accepted.length === 0 || rejected.length > 0) {
      return { ok: false, error: "smtp_recipient_rejected" };
    }
    return { ok: true, messageId: info.messageId ?? null };
  } catch (err) {
    return { ok: false, error: classify(err) };
  } finally {
    transport.close();
  }
}

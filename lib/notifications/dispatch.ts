/**
 * Notification dispatch hook (Phase 1.6) — STUB. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The seam where an out-of-band channel (email today, SMS later — DEC-B05)
 * would deliver a notification. This phase ships NO external provider: the hook
 * is a no-op unless NOTIFICATIONS_EMAIL_ENABLED=true, in which case it only logs
 * (so the wiring is observable in dev/staging without sending anything).
 *
 * When a provider is chosen, implement delivery here and record status on the
 * notification row. Until then: in-app notifications are the only channel.
 */
import "server-only";
import type { NotificationType } from "./types";

export type DispatchPayload = {
  id: string;
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
};

export async function dispatchNotification(n: DispatchPayload): Promise<void> {
  const enabled = process.env.NOTIFICATIONS_EMAIL_ENABLED === "true";
  if (!enabled) return; // default: in-app only, no external delivery this phase

  // PLAN (deferred): route to an email provider (Resend / SES / SMTP), then
  // persist delivery status. No provider is integrated in Phase 1.6.
  console.info(
    `[notifications] (stub) email channel enabled — would deliver "${n.title}" to user ${n.userId}`,
  );
}

/**
 * Welcome-email outcome classification (Phase 5.0E-4). PURE — unit-testable.
 * ---------------------------------------------------------------------------
 * The single place that decides which honest WelcomeOutcome a welcome attempt
 * produced, from three observable facts. Keeping it pure means the "never claim an
 * email was sent when it was not" rule is a property a test can pin, not a comment.
 */
import type { WelcomeOutcome } from "./types";

export type WelcomeSignals = {
  /** Is an email provider actually configured (resend/smtp), not the no-op stub? */
  providerConfigured: boolean;
  /** Did GoTrue mint a setup/recovery link? */
  linkGenerated: boolean;
  /** Did the delivery attempt succeed? Meaningful only when a provider is configured. */
  deliveryAccepted: boolean;
};

export function classifyWelcome(sig: WelcomeSignals): WelcomeOutcome {
  if (!sig.providerConfigured) {
    // No provider: we do not pretend to email. We hand back the link if we have one.
    return sig.linkGenerated ? "link_returned" : "provider_unavailable";
  }
  if (!sig.linkGenerated) return "link_generation_failed";
  return sig.deliveryAccepted ? "email_sent" : "delivery_failed";
}

/** Only a true, provider-backed delivery counts as "the welcome email was sent". */
export function isDelivered(outcome: WelcomeOutcome): boolean {
  return outcome === "email_sent";
}

/** Whether this outcome should hand a one-time setup link back to the admin to display. */
export function returnsLink(outcome: WelcomeOutcome): boolean {
  return outcome === "link_returned";
}

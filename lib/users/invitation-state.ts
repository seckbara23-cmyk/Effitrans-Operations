/**
 * Derived staff invitation state (Phase 6.0E-3). PURE — no I/O, unit-testable.
 * ---------------------------------------------------------------------------
 * There is no separate "invitation" entity — an invite IS an app_user row plus a GoTrue
 * recovery link handed out at creation. So the invitation state is DERIVED from the three
 * facts already on app_user: whether they have ever logged in, whether they are active,
 * and whether a provider-backed welcome was recorded. We never infer "pending" from the
 * mere absence of a login (that is not this product's rule); every state names a real
 * fact.
 *
 *   setup_completed — has logged in at least once (last_login_at set): the invite is moot.
 *   cancelled       — deactivated before ever logging in: getCurrentUser blocks them, so
 *                     any outstanding setup link is unusable — real, not cosmetic.
 *   email_sent      — a provider-backed welcome was delivered (onboarding_email_sent_at).
 *   no_invitation   — no delivery recorded (created without email, or delivery unconfirmed).
 */
export type InvitationState = "setup_completed" | "cancelled" | "email_sent" | "no_invitation";

export type InvitationFacts = {
  status: string;
  lastLoginAt: string | null;
  onboardingEmailSentAt: string | null;
};

export function deriveInvitationState(u: InvitationFacts): InvitationState {
  if (u.lastLoginAt) return "setup_completed";
  if (u.status !== "active") return "cancelled";
  if (u.onboardingEmailSentAt) return "email_sent";
  return "no_invitation";
}

/**
 * A resend / regenerate is meaningful only for an ACTIVE user who has not yet completed
 * setup — there is an outstanding invitation to (re)deliver. Not for someone already
 * logged in (setup_completed), nor for a cancelled (deactivated) user (reactivate first).
 */
export function canResendInvitation(state: InvitationState): boolean {
  return state === "email_sent" || state === "no_invitation";
}

/**
 * Cancellation applies only when there is an outstanding, unused invitation — an active
 * user who has never logged in. A user who has completed setup is a normal active user
 * (disable them via the tenant user-status control, a different operation), and a
 * cancelled invite cannot be cancelled again.
 */
export function canCancelInvitation(state: InvitationState): boolean {
  return state === "email_sent" || state === "no_invitation";
}

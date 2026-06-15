/**
 * OAuth identity gate — PURE decision logic (Phase 1.16). No I/O, unit-tested.
 * ---------------------------------------------------------------------------
 * Given the profile resolved BY auth.users.id (never by email) and the verified
 * Google email, decide whether a staff Google login is allowed. The lookup-by-id
 * happens in the server caller (lib/auth/oauth.ts); this module only judges, so
 * the rules are testable in isolation. Email comparison is an ADDITIONAL
 * assertion — it can only tighten the by-id decision, never widen it.
 *
 * Rules (DEC-B25): allow iff an ACTIVE app_user exists for this auth id AND its
 * email equals the verified Google email. Otherwise reject with a reason.
 */
export type OAuthGateProfile = {
  /** app_user.email for the row whose id === auth.users.id (null if no row) */
  email: string | null;
  /** app_user.status ("active" | "inactive"); null if no row */
  status: string | null;
} | null;

export type OAuthGateInput = {
  /** the profile found by auth.users.id (null = no staff profile for this id) */
  profile: OAuthGateProfile;
  /** the email on the authenticated Supabase user (the linked Google identity) */
  authEmail: string | null;
  /** whether that email is verified (email_confirmed_at / identity email_verified) */
  emailVerified: boolean;
};

export type OAuthGateResult =
  | { ok: true }
  | { ok: false; reason: "no_email" | "email_unverified" | "not_staff" | "disabled" | "email_mismatch" };

/** Case/whitespace-insensitive email normalization for the match assertion. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function evaluateStaffOAuth(input: OAuthGateInput): OAuthGateResult {
  const authEmail = normalizeEmail(input.authEmail);
  if (!authEmail) return { ok: false, reason: "no_email" };
  // Only trust a Google-verified email — an unverified one could be spoofed.
  if (!input.emailVerified) return { ok: false, reason: "email_unverified" };

  // No staff profile for this auth id = unknown user OR a portal-only user
  // reaching the staff gate. Either way: rejected, no auto-creation.
  if (!input.profile) return { ok: false, reason: "not_staff" };
  if (input.profile.status !== "active") return { ok: false, reason: "disabled" };

  // Defense in depth: the by-id profile's email must match the verified email.
  if (normalizeEmail(input.profile.email) !== authEmail) return { ok: false, reason: "email_mismatch" };

  return { ok: true };
}

/**
 * Is this by-id profile an ACTIVE staff member? Used by the password-recovery
 * gate (Phase 1.16): only active app_user accounts may request or complete a
 * staff password reset. Pure so it stays unit-tested alongside the OAuth gate.
 */
export function isActiveStaff(profile: OAuthGateProfile): boolean {
  return !!profile && profile.status === "active";
}

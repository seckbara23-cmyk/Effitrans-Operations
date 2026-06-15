/**
 * Portal OAuth identity gate — PURE decision logic (Phase 1.16). No I/O.
 * ---------------------------------------------------------------------------
 * The portal mirror of lib/auth/oauth-gate. Given the client_user profile
 * resolved BY auth.users.id (never by email) and the verified Google email,
 * decide whether a portal Google login is allowed. Portal status semantics
 * differ from staff: INVITED is allowed and ACTIVATES on first Google login;
 * only DISABLED (or no profile / mismatch / unverified) is rejected. Email
 * match is an ADDITIONAL assertion, never the lookup key.
 */
import { normalizeEmail } from "@/lib/auth/oauth-gate";

export type PortalGateProfile = {
  email: string | null;
  status: string | null; // INVITED | ACTIVE | DISABLED
} | null;

export type PortalGateInput = {
  profile: PortalGateProfile;
  authEmail: string | null;
  emailVerified: boolean;
};

export type PortalGateResult =
  | { ok: true; activate: boolean }
  | { ok: false; reason: "no_email" | "email_unverified" | "not_portal" | "disabled" | "email_mismatch" };

export function evaluatePortalOAuth(input: PortalGateInput): PortalGateResult {
  const authEmail = normalizeEmail(input.authEmail);
  if (!authEmail) return { ok: false, reason: "no_email" };
  if (!input.emailVerified) return { ok: false, reason: "email_unverified" };

  // No portal profile for this id = unknown OR a staff-only user at the portal
  // gate → rejected, no auto-creation.
  if (!input.profile) return { ok: false, reason: "not_portal" };
  if (input.profile.status === "DISABLED") return { ok: false, reason: "disabled" };
  if (normalizeEmail(input.profile.email) !== authEmail) return { ok: false, reason: "email_mismatch" };

  // INVITED (first login) or ACTIVE. Activate an invited user.
  return { ok: true, activate: input.profile.status === "INVITED" };
}

/** May this portal profile request/complete a password reset? (anything but DISABLED) */
export function isResettablePortal(profile: PortalGateProfile): boolean {
  return !!profile && profile.status !== "DISABLED";
}

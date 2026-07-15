/**
 * Shared user-management types (Task 6a). Safe for client + server import.
 */
export type AdminUserRole = {
  roleId: string;
  code: string;
  labelFr: string | null;
};

import type { Presence } from "./presence";

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  status: "active" | "inactive";
  isSystemAdmin: boolean;
  roles: AdminUserRole[];
  // Phase 2.1A — presence & login metadata (admin visibility).
  presence: Presence;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  lastLoginMethod: string | null;
  loginCount: number;
  onboardingEmailSentAt: string | null;
};

/** SYSTEM_ADMIN dashboard presence summary. */
export type PresenceSummary = {
  online: number;
  activeToday: number;
  neverLoggedIn: number;
  portalActiveToday: number;
};

export type AssignableRole = {
  id: string;
  code: string;
  labelFr: string | null;
};

/**
 * Outcome of the secure welcome / set-password link (Phase 5.0E-4). Honest and
 * closed: the UI can NEVER claim an email was sent when it was not.
 *   email_sent            provider configured AND delivery accepted;
 *   link_returned         no provider — the one-time setup link is handed back for the
 *                         admin to deliver out of band (never emailed, never persisted);
 *   provider_unavailable  no provider AND no link could be generated either;
 *   link_generation_failed provider configured but GoTrue could not mint the link;
 *   delivery_failed       link minted, provider configured, but the send failed;
 *   skipped               the admin did not request a welcome.
 */
export type WelcomeOutcome =
  | "email_sent"
  | "link_returned"
  | "provider_unavailable"
  | "link_generation_failed"
  | "delivery_failed"
  | "skipped";

/** How the new user's initial credential is established (Phase 5.0E-4). */
export type CredentialMode = "setup_email" | "generate" | "manual";

/**
 * The safe, closed error vocabulary every user action maps to French. NEVER a raw
 * GoTrue / Supabase / service-role string.
 */
export type CreateUserError =
  | "forbidden"
  | "invalid_email"
  | "weak_password"
  | "invalid_role"
  | "email_conflict"
  | "auth_failed"
  | "profile_failed"
  | "not_found"
  | "cannot_disable_self"
  | "cannot_revoke_own_admin"
  | "welcome_failed"
  | "generic";

export type ActionResult =
  | {
      ok: true;
      welcome?: WelcomeOutcome;
      /**
       * The one-time temporary password — present ONLY for credentialMode "generate",
       * ONLY in this immediate result. Never persisted, logged, audited, or returned
       * again. The UI shows it once and then it is gone.
       */
      temporaryPassword?: string;
      /** The one-time setup link — present ONLY when welcome === "link_returned". */
      setupLink?: string;
      userId?: string;
    }
  | { ok: false; error: CreateUserError };

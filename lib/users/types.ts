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

/** Outcome of the optional welcome email queued after user creation. */
export type WelcomeOutcome = "queued" | "skipped" | "failed";

export type ActionResult =
  | { ok: true; welcome?: WelcomeOutcome }
  | { ok: false; error: string };

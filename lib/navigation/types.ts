/**
 * Navigation contract (Phase 5.0E-1). PURE types.
 * ---------------------------------------------------------------------------
 * ONE contract for every navigation decision. Before this, the sidebar merged a
 * static `lib/nav.ts` with a role-aware process nav and made its own visibility
 * calls — three places deciding what a user may see. Now there is one builder, it
 * runs on the SERVER (the only place that knows the flags and the user's roles),
 * and the client just renders what it is handed.
 */
import type { ProcessFlags } from "@/lib/process/flags";

/**
 * Which identity STACK the viewer belongs to. These are separate authentication
 * systems and must never be merged: a platform admin is not a tenant user, and a
 * portal client is not staff.
 *
 * Note that COURIER is deliberately NOT here — a coursier is a tenant staff user
 * with a role, not a separate identity. Modelling it as an identity would have
 * given them their own shell and cut them off from the dossiers they carry.
 */
export type IdentityType = "tenant" | "platform" | "driver" | "portal" | "anonymous";

export type NavigationContext = {
  userId: string;
  tenantId: string;
  /** Tenant role codes (SYSTEM_ADMIN, COORDINATOR, …). Never platform roles. */
  roleCodes: string[];
  permissions: string[];
  identityType: IdentityType;
  featureFlags: ProcessFlags;
};

/** Icon key — a component cannot cross the server→client boundary. */
export type NavIconKey =
  | "tower"
  | "stamp"
  | "truck"
  | "finance"
  | "document"
  | "building"
  | "users"
  | "container"
  | "bell"
  | "report";

export type NavigationItem = {
  key: string;
  label: string;
  href: string;
  iconKey: NavIconKey;
  /**
   * Cosmetic only — the ROUTE re-checks server-side. Kept so the client can hide
   * an item without a round trip, never as the authorization itself.
   */
  permission?: string;
  /** Actionable count. Only ever set when it can be derived cheaply. */
  badge?: number;
  /** A short description shown on hover / in the mobile drawer. */
  hint?: string;
};

export type NavigationSection = {
  key: string;
  label: string;
  items: NavigationItem[];
};

/** Everything the shell needs, computed once on the server. */
export type Navigation = {
  sections: NavigationSection[];
  /** The user's primary operational role, in French. Never a raw role code. */
  primaryRoleLabel: string | null;
  /** Where "Mon travail" lives, when the user has one. */
  myWorkHref: string | null;
  /**
   * Whether `sections` has ALREADY been filtered against this user's permissions.
   *
   * True on the role-aware path: the server knew who was asking, so the client
   * renders exactly what it is handed.
   *
   * False on the legacy (workspaces-off) path: the layout deliberately resolves NO
   * session there — the flag is checked before any auth call, so a flag-off app
   * does zero auth work in the layout and pages like /login still prerender
   * statically. The client applies the same cosmetic `canSeeNav` filter it always
   * has. Either way the routes re-check server-side; this only decides what is
   * SHOWN, never what is allowed.
   */
  filtered: boolean;
};

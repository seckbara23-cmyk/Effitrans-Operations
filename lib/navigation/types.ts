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
 * Which identity STACK the viewer belongs to. These are separate surfaces and must
 * never be merged: a platform admin is not a tenant user, and a portal client is not
 * staff.
 *
 * COURIER-ONLY is one of them (Phase 5.0E-3). A coursier is a tenant user with a
 * tenant role, but their entire job is the deposit run: they hold no analytics:read,
 * no file:read, and they staff exactly one queue. Giving them the staff sidebar meant
 * giving them a shell whose every section was empty. They get their own surface at
 * /courier, exactly like a driver.
 *
 * "Courier-ONLY" is the operative word: someone holding COURIER *and* a supervisory
 * role is still staff. The narrow identity is inferred from the absence of any other
 * operational role, never from the presence of COURIER.
 */
export type IdentityType = "tenant" | "platform" | "driver" | "courier" | "portal" | "anonymous";

export type NavigationContext = {
  userId: string;
  tenantId: string;
  /** Tenant role codes (SYSTEM_ADMIN, COORDINATOR, …). Never platform roles. */
  roleCodes: string[];
  permissions: string[];
  identityType: IdentityType;
  featureFlags: ProcessFlags;
  /**
   * Phase 8.7 — Effitrans Messaging Center rollout flag for THIS tenant. Independent
   * of featureFlags (the process engine) by design. Optional/defaults to false so
   * existing fixtures/tests that predate this flag are unaffected (messaging simply
   * stays hidden for them, exactly as an unresolved rollout fails closed elsewhere).
   */
  messagingEnabled?: boolean;
};

/** Icon key — a component cannot cross the server→client boundary. */
export type NavIconKey =
  | "star"
  | "tower"
  | "stamp"
  | "truck"
  | "finance"
  | "document"
  | "building"
  | "users"
  | "container"
  | "bell"
  | "report"
  | "message";

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

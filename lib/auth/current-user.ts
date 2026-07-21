/**
 * Current-user loading + tenant resolution (AUTH-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Resolves the authenticated Supabase user -> app_user profile -> tenant ->
 * role codes. All reads go through the RLS-respecting server client, so a user
 * only ever resolves their own profile and their own tenant's data.
 *
 * No business-domain logic. Returns null when unauthenticated. Local casts are
 * used because generated DB types (lib/db/types.ts) do not exist until the
 * project is linked and `npm run db:types` is run.
 */
import { cache } from "react";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { touchStaffSeen } from "@/lib/users/presence-track";
import { classifySession, type SessionClass } from "./session-class";
import {
  tenantBlockReason,
  isLifecycleStatus,
  type LifecycleStatus,
  type TenantBlockReason,
} from "@/lib/platform/company-metadata";

export type CurrentUser = {
  /** app_user.id === auth.users.id */
  id: string;
  /** organization.id this user belongs to */
  tenantId: string;
  email: string;
  isSystemAdmin: boolean;
  /** role codes held by the user (union resolution for permissions elsewhere) */
  roles: string[];
};

type UserRoleRow = { role: { code: string } | null };

type OrgLifecycle = { lifecycle_status: string; trial_ends_at: string | null };

/** Supabase returns an embedded to-one relation as an object OR a one-element array. */
function normalizeOrg(rel: unknown): OrgLifecycle | null {
  const row = Array.isArray(rel) ? rel[0] : rel;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.lifecycle_status !== "string") return null;
  return {
    lifecycle_status: r.lifecycle_status,
    trial_ends_at: typeof r.trial_ends_at === "string" ? r.trial_ends_at : null,
  };
}

/**
 * P1: request-scoped memoization. assertPermission/requireUser and every gated
 * service call resolve the current user; React cache() dedupes them to a SINGLE
 * app_user + user_role lookup per request render.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Typed via the Database generic on the client. The embedded organization read is
  // the LIFECYCLE ENFORCEMENT input (Phase 6.0D): a tenant user may read their own
  // org row (organization_select_own RLS), so this costs no extra query.
  const { data: profile } = await supabase
    .from("app_user")
    .select(
      "id, tenant_id, email, is_system_admin, status, last_seen_at, organization:tenant_id(lifecycle_status, trial_ends_at)",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  // Disabled users must not access protected app areas — treat as no session.
  if (profile.status !== "active") return null;

  // THE SINGLE LIFECYCLE ENFORCEMENT POINT (Phase 6.0D). A suspended / archived tenant
  // — or a trial whose window has ended — resolves to NO session, exactly like a
  // disabled user. Because every protected page (requireUser) and every gated action
  // (assertPermission) funnels through here, that one line denies logins, authenticated
  // requests, engine/background actions and rollout for the whole tenant. Platform
  // admins are unaffected: they have no app_user and resolve via getPlatformUser.
  const org = normalizeOrg(profile.organization);
  if (org && isLifecycleStatus(org.lifecycle_status)) {
    if (tenantBlockReason(org.lifecycle_status, org.trial_ends_at, Date.now()) !== null) {
      return null;
    }
  }

  // Phase 2.1A — presence heartbeat on authenticated load (throttled, best-effort).
  // Kicked off here but NOT awaited ahead of the roles query, so the (at most
  // once-per-minute) write overlaps the roles fetch instead of serialising in
  // front of it and blocking navigation. It uses the admin client — a separate
  // connection from the roles query — so the two run in parallel. Still awaited
  // before returning (touchStaffSeen never throws), so presence stays reliable.
  const seen = touchStaffSeen(profile.id, profile.last_seen_at);

  // Embedded relation result asserted via .returns<T>() (intentional, not a hack).
  const { data: roleData } = await supabase
    .from("user_role")
    .select("role:role_id(code)")
    .eq("user_id", user.id)
    .returns<UserRoleRow[]>();

  await seen;

  const roleRows = roleData ?? [];
  const roles = roleRows
    .map((r) => r.role?.code)
    .filter((c): c is string => Boolean(c));

  return {
    id: profile.id,
    tenantId: profile.tenant_id,
    email: profile.email,
    isSystemAdmin: profile.is_system_admin,
    roles,
  };
});

/**
 * Why the current STAFF session is blocked by lifecycle, or null (Phase 6.0D).
 *
 * getCurrentUser() returns null for a blocked tenant, which is correct for enforcement
 * but indistinguishable from "not logged in" — and that ambiguity is what would loop a
 * suspended user between /login and /dashboard. This tells the routing layer (requireUser,
 * the login page) the REASON, so a blocked user lands on /login with an explanation
 * instead of bouncing. Reads own rows only (RLS); request-memoized.
 */
export const getStaffTenantBlockReason = cache(async (): Promise<TenantBlockReason | null> => {
  const supabase = getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("app_user")
    .select("status, organization:tenant_id(lifecycle_status, trial_ends_at)")
    .eq("id", user.id)
    .maybeSingle();
  if (!data || data.status !== "active") return null;

  const org = normalizeOrg(data.organization);
  if (!org || !isLifecycleStatus(org.lifecycle_status)) return null;
  return tenantBlockReason(org.lifecycle_status as LifecycleStatus, org.trial_ends_at, Date.now());
});

/**
 * Classify the current session as staff / portal / none (Phase 3.2B hotfix).
 * Used by the staff guard + staff login redirect so a valid PORTAL session is
 * routed to the portal, never bounced into the staff /login ⇄ /dashboard loop.
 * Request-scoped memoized. Reads own rows only (self-select RLS on both tables).
 */
export const getSessionClass = cache(async (): Promise<SessionClass> => {
  const supabase = getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "none";

  // hasAppUser requires status='active', matching getCurrentUser's own rule (line 77
  // above: a non-active app_user is treated as no session there). Customer-identity
  // routing fix: a STALE app_user row (suspended/archived — e.g. left over from a
  // corrected mis-provisioning) must never shadow a real, active client_user and force
  // "staff" classification. Table EXISTENCE alone is not identity; an active row is.
  const [{ data: appUser }, { data: clientUser }] = await Promise.all([
    supabase.from("app_user").select("id").eq("id", user.id).eq("status", "active").maybeSingle(),
    supabase.from("client_user").select("id").eq("id", user.id).maybeSingle(),
  ]);
  return classifySession(Boolean(appUser), Boolean(clientUser));
});

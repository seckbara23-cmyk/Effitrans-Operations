import "server-only";

/**
 * Bounded tenant session revocation (Phase 6.0E-4). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Supabase Auth (supabase-js 2.108) exposes NO "delete sessions by user id" admin call;
 * signOut(jwt) needs the user's own access token, which an admin does not hold. The one
 * supported, safe per-user lever is a BAN via updateUserById(id, { ban_duration }):
 *   - a banned user cannot obtain a NEW session (login is rejected), and
 *   - cannot REFRESH an existing one (the refresh grant is rejected),
 * so the renewable session is revoked at the auth layer immediately. The residual,
 * short-lived (<=1h) access token is already denied on the very next request by the
 * Phase 6.0D enforcement (getCurrentUser returns null for a blocked tenant) — so there is
 * no window of protected access.
 *
 * HONEST BOUNDARY (reported, not glossed): a ban GATES tokens; it does not DELETE them.
 * On reactivation we un-ban so users can authenticate again — this manufactures no
 * session, but the supported API cannot force-delete a not-yet-expired refresh token, so
 * that is the exact limit of what "revocation" means here.
 *
 * BOUNDED + tenant-scoped: user ids come from app_user WHERE tenant_id = the target
 * tenant (never the global auth user list), so cross-tenant revocation is structurally
 * impossible. Partial provider failures are counted and returned, never thrown — a failed
 * ban must not roll back a lifecycle transition that already succeeded.
 */
import type { getAdminSupabaseClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/** ~100 years — effectively permanent until explicitly lifted with "none". */
const PERMANENT_BAN = "876000h";
const UNBAN = "none";
const PAGE = 200;
/** Safety ceiling on how many users one lifecycle action will touch. */
const MAX_USERS = 10_000;
/** Cap concurrent admin calls so a large tenant does not fan out unbounded. */
const CONCURRENCY = 10;

export type RevocationSummary = { targeted: number; revoked: number; failed: number };

/** The target tenant's auth user ids — a bounded, tenant-scoped read (never global). */
async function tenantUserIds(admin: Admin, tenantId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 0; page * PAGE < MAX_USERS; page++) {
    const { data, error } = await admin
      .from("app_user")
      .select("id")
      .eq("tenant_id", tenantId)
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) break;
    const rows = data ?? [];
    for (const r of rows) ids.push(r.id as string);
    if (rows.length < PAGE) break;
  }
  return ids;
}

/**
 * Ban (suspend / archive) or un-ban (reactivate) every auth user of ONE tenant, in
 * bounded concurrent chunks. Returns a safe summary — counts only, never a token,
 * session id, or provider error string.
 */
export async function setTenantAuthBan(
  admin: Admin,
  tenantId: string,
  banned: boolean,
): Promise<RevocationSummary> {
  const banDuration = banned ? PERMANENT_BAN : UNBAN;
  const ids = await tenantUserIds(admin, tenantId);

  let revoked = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const chunk = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: banDuration });
          return !error;
        } catch {
          return false;
        }
      }),
    );
    for (const ok of results) ok ? revoked++ : failed++;
  }

  return { targeted: ids.length, revoked, failed };
}

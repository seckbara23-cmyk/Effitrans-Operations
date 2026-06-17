/**
 * Presence writers (Phase 2.1A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Best-effort metadata writes via the service-role admin client. Login writers
 * bump last_login_at/last_seen_at/last_login_method and increment login_count;
 * the seen "heartbeat" updates last_seen_at on authenticated load, throttled so
 * navigation never causes a write storm. NEVER throw — auth/render must not
 * depend on presence bookkeeping.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

const SEEN_THROTTLE_MS = 60_000;

async function recordLogin(table: "app_user" | "client_user", userId: string, method: string): Promise<void> {
  try {
    const admin = getAdminSupabaseClient();
    const { data } = await admin.from(table).select("login_count").eq("id", userId).maybeSingle<{ login_count: number | null }>();
    const now = new Date().toISOString();
    await admin
      .from(table)
      .update({
        last_login_at: now,
        last_seen_at: now,
        last_login_method: method,
        login_count: (data?.login_count ?? 0) + 1,
      })
      .eq("id", userId);
  } catch {
    /* best-effort */
  }
}

async function touchSeen(table: "app_user" | "client_user", userId: string, lastSeenAt: string | null | undefined): Promise<void> {
  try {
    if (lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < SEEN_THROTTLE_MS) return;
    const admin = getAdminSupabaseClient();
    await admin.from(table).update({ last_seen_at: new Date().toISOString() }).eq("id", userId);
  } catch {
    /* best-effort */
  }
}

export const recordStaffLogin = (userId: string, method: string) => recordLogin("app_user", userId, method);
export const recordPortalLogin = (userId: string, method: string) => recordLogin("client_user", userId, method);
export const touchStaffSeen = (userId: string, lastSeenAt: string | null | undefined) => touchSeen("app_user", userId, lastSeenAt);
export const touchPortalSeen = (userId: string, lastSeenAt: string | null | undefined) => touchSeen("client_user", userId, lastSeenAt);

/**
 * Test double for `lib/supabase/server` — part of the SESSION seam, not a second one.
 * ---------------------------------------------------------------------------
 * `getServerSupabaseClient()` builds a Supabase client from the request's
 * cookies. In Node there is no request and no cookie jar, so it cannot be
 * constructed at all — and `getEffectivePermissions` uses it to call
 * `get_user_permissions(p_user)`.
 *
 * Substituting a service client here does NOT weaken any authority check. The
 * RPC still resolves the REAL grants of the REAL user id the harness is acting
 * as, so `assertPermission` still refuses an actor who lacks a permission —
 * proven in the journey itself, where a COURIER is refused `createFile` and a
 * signed-out caller is refused outright. What changes is only HOW the query is
 * transported, which is precisely what "the session" means in a Node process.
 *
 * RLS-dependent reads are asserted separately in the SQL suites, which run
 * against real policies as real roles; this harness proves the ACTION layer.
 */
import { createClient } from "@supabase/supabase-js";

export function getServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("journey harness: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function getPublicEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

/**
 * Supabase server client — STUB (Wave 2).
 * ---------------------------------------------------------------------------
 * SERVER-ONLY. The real client (built on @supabase/ssr with the request's
 * auth session, and the service-role key for privileged operations) is wired
 * in Wave 3 (AUTH-1 / AUTH-3). The service-role key MUST never reach the
 * client bundle — only this server module may read it (via lib/env.ts
 * getServerEnv()).
 *
 * Kept as a throwing stub so the module path exists and nothing accidentally
 * constructs an unconfigured client before Wave 3.
 */

export function getServerSupabaseClient() {
  throw new Error(
    "[supabase] server client is not wired yet (Wave 3 / AUTH-1). See docs/SETUP.md.",
  );
}

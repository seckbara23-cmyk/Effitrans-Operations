/**
 * Supabase browser client — STUB (Wave 2).
 * ---------------------------------------------------------------------------
 * Browser-safe. The real client (built on @supabase/ssr with the public URL +
 * anon key only — RLS is the security boundary) is wired in Wave 3 (AUTH-1).
 * This module must NEVER reference the service-role key.
 *
 * Kept as a throwing stub so the module path exists and nothing constructs an
 * unconfigured client before Wave 3.
 */

export function getBrowserSupabaseClient() {
  throw new Error(
    "[supabase] browser client is not wired yet (Wave 3 / AUTH-1). See docs/SETUP.md.",
  );
}

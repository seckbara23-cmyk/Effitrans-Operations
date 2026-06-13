/**
 * Supabase browser client (anon key only — RLS is the security boundary).
 * ---------------------------------------------------------------------------
 * Browser-safe. Uses ONLY the public URL + anon key. Never references the
 * service-role key.
 */
import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

export function getBrowserSupabaseClient() {
  const env = getPublicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

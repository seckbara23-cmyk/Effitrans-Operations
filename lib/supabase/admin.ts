/**
 * Supabase ADMIN client (service-role, bypasses RLS). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * `import "server-only"` makes the build FAIL if this module is ever imported
 * into a client component — the strongest guarantee that the service-role key
 * never reaches the browser bundle (security requirement).
 *
 * Use ONLY for trusted server-side privileged operations: audit writes
 * (lib/audit/log.ts), user/role provisioning. Never for rendering user data.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

export function getAdminSupabaseClient() {
  const env = getServerEnv();
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

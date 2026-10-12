/**
 * Supabase server client (user-context, RLS-respecting). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Built on @supabase/ssr with the request cookies + the PUBLIC anon key. All
 * queries run as the authenticated user, so RLS policies (auth.uid()) apply.
 * This client does NOT use the service-role key — privileged writes use
 * lib/supabase/admin.ts instead.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";
import { assertSupabaseBinding } from "@/lib/env/binding-runtime";
import { tracedFetch } from "@/lib/perf/trace";
import type { Database } from "@/lib/db/types";

export function getServerSupabaseClient() {
  // EFF-STAGING-ISOLATION-02 — RLS-bound, yet six modules write through this
  // client (portal activation, password changes, customer notifications), so
  // it is not a read-only path and gets the same guard.
  assertSupabaseBinding();
  const env = getPublicEnv();
  const cookieStore = cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Called from a Server Component render in some paths — ignore there;
          // middleware (lib/supabase/middleware.ts) is responsible for refresh.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            /* no-op: read-only cookie context */
          }
        },
      },
      // PERF-UX-01 — counts and times requests (auth included) made inside a
      // traced request. Transparent otherwise: the platform fetch, unchanged.
      global: { fetch: tracedFetch },
    },
  );
}

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

export function getServerSupabaseClient() {
  const env = getPublicEnv();
  const cookieStore = cookies();

  return createServerClient(
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
    },
  );
}

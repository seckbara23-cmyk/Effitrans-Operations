/**
 * Session refresh helper for Next.js middleware (AUTH-3).
 * ---------------------------------------------------------------------------
 * Keeps the Supabase auth session fresh on each request by reading/writing
 * cookies. It does NOT perform business-domain redirects (Wave 3 constraint) —
 * route guarding for protected pages is done explicitly via lib/auth/require-user.
 *
 * Gracefully no-ops when Supabase env is absent, so the existing mock UI keeps
 * working before a real project is linked.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured yet — pass through (mock UI / pre-link).
  if (!url || !anon) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Touch the session to trigger token refresh when needed.
  await supabase.auth.getUser();

  return response;
}

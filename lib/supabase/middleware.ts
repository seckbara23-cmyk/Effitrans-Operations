/**
 * Session refresh + route protection for Next.js middleware (AUTH-3).
 * ---------------------------------------------------------------------------
 * Keeps the Supabase auth session fresh on each request AND redirects
 * unauthenticated users away from protected routes to /login (edge-level, so
 * pages never render a half-authenticated shell). Page-level guards
 * (require-user / permission / disabled-user) remain authoritative on top.
 *
 * Gracefully no-ops when Supabase env is absent, so the app keeps rendering
 * (degraded) before the project is configured.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes reachable without authentication.
function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth");
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured — pass through (cannot authenticate; avoid redirect loops).
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

  // Touch the session to trigger token refresh and learn who (if anyone) is signed in.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Unauthenticated -> redirect protected routes to /login.
  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user landing on /login -> send to the dashboard.
  if (user && pathname === "/login") {
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashUrl);
  }

  return response;
}

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
import { classifySession } from "@/lib/auth/session-class";
import { tenantBlockReason, isLifecycleStatus, type LifecycleStatus } from "@/lib/platform/company-metadata";

/** True when the staff row's embedded organization is lifecycle-blocked (6.0D). */
function isStaffTenantBlocked(appUser: unknown): boolean {
  const rel = (appUser as { organization?: unknown } | null)?.organization;
  const row = Array.isArray(rel) ? rel[0] : rel;
  const status = (row as { lifecycle_status?: unknown } | null)?.lifecycle_status;
  const trialEndsAt = (row as { trial_ends_at?: unknown } | null)?.trial_ends_at;
  if (typeof status !== "string" || !isLifecycleStatus(status)) return false;
  return (
    tenantBlockReason(
      status as LifecycleStatus,
      typeof trialEndsAt === "string" ? trialEndsAt : null,
      Date.now(),
    ) !== null
  );
}

// Routes reachable without authentication. The OAuth callbacks + the password
// reset pages (Phase 1.16) MUST be public: they run the code→session exchange,
// so the request arrives BEFORE the session cookie exists — redirecting them
// would drop the code. Both the staff (/auth/*) and portal (/portal/auth/*)
// entry points are covered, plus the two login pages.
function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/portal/login" ||
    pathname.startsWith("/auth") || // /auth/callback, /auth/update-password
    pathname.startsWith("/portal/auth") || // /portal/auth/callback, /portal/auth/update-password
    pathname.startsWith("/card") || // DBC-3 — public digital business cards (token capability)
    pathname === "/api/version" || // 8.0B gate C1 — secret-free build-info for deploy verification
    pathname === "/offline" // 8.3 PWA — public offline fallback (pre-cached by the service worker)
  );
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
  // Phase 8.0A (F-7): a stale/revoked refresh cookie surfaced AuthApiError
  // ("Invalid Refresh Token: Refresh Token Not Found") as PRODUCTION runtime errors from this
  // middleware. Any auth failure here simply means "not signed in" — swallow it and let the
  // existing unauthenticated path redirect to the matching login instead of erroring the request.
  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null; // treat as signed out — never a 500 for a stale cookie
  }

  const pathname = request.nextUrl.pathname;

  // DBC-3 — public business cards are never indexed by default (the RSC page cannot set a
  // response header; this covers the page + its download routes).
  if (pathname.startsWith("/card")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  // Unauthenticated -> redirect protected routes to the matching login (portal
  // routes to the portal login, everything else to the staff login).
  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = pathname.startsWith("/portal") ? "/portal/login" : "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user landing on the STAFF /login -> route by identity class so
  // a PORTAL session is never thrown into the staff /login <-> /dashboard loop.
  // Only this rare authenticated-/login path pays the extra self-row lookups.
  if (user && pathname === "/login") {
    const [{ data: appUser }, { data: clientUser }, { data: platformAdmin }] = await Promise.all([
      // Phase 6.0D — the staff lookup carries the tenant lifecycle so a blocked tenant
      // is NOT bounced back to /dashboard (which would loop, since the dashboard's
      // requireUser resolves them to null again). A blocked staff user stays on /login,
      // where the page shows the reason.
      supabase
        .from("app_user")
        .select("id, organization:tenant_id(lifecycle_status, trial_ends_at)")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.from("client_user").select("id").eq("id", user.id).maybeSingle(),
      supabase.from("platform_admin").select("id").eq("id", user.id).maybeSingle(),
    ]);
    const cls = classifySession(Boolean(appUser), Boolean(clientUser));
    const staffBlocked = cls === "staff" && isStaffTenantBlocked(appUser);
    // Staff/portal land on their tenant home; a user who is ONLY a platform admin
    // (no tenant identity) lands on /platform. A lifecycle-blocked staff user stays on
    // /login. Otherwise render /login (no loop).
    let dest: string | null = null;
    if (cls === "staff") dest = staffBlocked ? null : "/dashboard";
    else if (cls === "portal") dest = "/portal";
    else if (platformAdmin) dest = "/platform";
    if (dest) {
      const url = request.nextUrl.clone();
      url.pathname = dest;
      return NextResponse.redirect(url);
    }
  }

  return response;
}

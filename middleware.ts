/**
 * Next.js middleware — Supabase session refresh (AUTH-3).
 * ---------------------------------------------------------------------------
 * Only refreshes the auth session on each request. NO business-domain redirects
 * (Wave 3 constraint). Page-level protection is opt-in via lib/auth/require-user.
 */
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on all routes except static assets and image optimization. 8.3: the PWA static
  // surface (manifest, service worker, icons) must be publicly fetchable — browsers request
  // them without an app session, and a redirect to /login breaks installability and SW
  // registration. They are pure static files; session refresh has no business running on them.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/).*)"],
};

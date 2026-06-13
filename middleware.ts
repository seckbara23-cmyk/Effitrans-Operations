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
  // Run on all routes except static assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

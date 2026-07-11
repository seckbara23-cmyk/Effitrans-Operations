/**
 * Staff Google OAuth callback (Phase 1.16). Route Handler (GET).
 * ---------------------------------------------------------------------------
 * Supabase redirects here with ?code= after the Google PKCE handshake. We
 * exchange the code for a session, then run the staff identity gate
 * (lib/auth/oauth). On success → /dashboard. On rejection → signOut (tears down
 * the just-created session) and back to /login with a generic error; the gate
 * has already deleted any orphan auth.users row. No portal flow here (deferred).
 */
import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { gateStaffOAuthLogin } from "@/lib/auth/oauth";
import { getCurrentUser } from "@/lib/auth/current-user";
import { reportMessage } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // admin client (service role) for the gate + orphan cleanup

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const loginUrl = (err?: string) => `${origin}/login${err ? `?error=${err}` : ""}`;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.redirect(loginUrl("oauth"));
  }

  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error");
  if (providerError || !code) {
    return NextResponse.redirect(loginUrl("oauth"));
  }

  const supabase = getServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    reportMessage("staff OAuth code exchange failed", { scope: "auth", event: "auth.callback.exchange" });
    return NextResponse.redirect(loginUrl("oauth"));
  }

  const outcome = await gateStaffOAuthLogin();
  if (!outcome.ok) {
    // Unknown / disabled / wrong-flow / email-mismatch: never leave a session standing.
    reportMessage("staff OAuth login rejected by identity gate", { scope: "auth", event: "auth.callback.gate_rejected" });
    await supabase.auth.signOut();
    return NextResponse.redirect(loginUrl("unauthorized"));
  }

  // Phase 3.4C — route a DRIVER to their mobile workspace.
  const user = await getCurrentUser();
  const dest = user?.roles.includes("DRIVER") ? "/driver" : "/dashboard";
  return NextResponse.redirect(`${origin}${dest}`);
}

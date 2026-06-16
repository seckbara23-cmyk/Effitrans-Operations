/**
 * Portal Google OAuth callback (Phase 1.16). Route Handler (GET).
 * ---------------------------------------------------------------------------
 * Portal mirror of /auth/callback. Supabase redirects here with ?code= after the
 * Google PKCE handshake. We exchange the code, then run the portal identity gate
 * (lib/portal/oauth). On success → /portal. On rejection → signOut and back to
 * /portal/login with a generic error; the gate has already deleted any orphan
 * auth.users row. Staff accounts reaching here are rejected, never deleted.
 */
import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { gatePortalOAuthLogin } from "@/lib/portal/oauth";
import { reportMessage } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // admin client (service role) for the gate + orphan cleanup

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const loginUrl = (err?: string) => `${origin}/portal/login${err ? `?error=${err}` : ""}`;

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
    reportMessage("portal OAuth code exchange failed", { scope: "auth", event: "portal.callback.exchange" });
    return NextResponse.redirect(loginUrl("oauth"));
  }

  const outcome = await gatePortalOAuthLogin();
  if (!outcome.ok) {
    reportMessage("portal OAuth login rejected by identity gate", { scope: "auth", event: "portal.callback.gate_rejected" });
    await supabase.auth.signOut();
    return NextResponse.redirect(loginUrl("unauthorized"));
  }

  return NextResponse.redirect(`${origin}/portal`);
}

"use client";

/**
 * Staff login (UI-2; Phase 1.16 Google OAuth + password recovery).
 * ---------------------------------------------------------------------------
 * Email/password + "Continue with Google" + a "forgot password" mode. Generic
 * messages only (never reveal whether an email exists). Browser client (anon
 * key) for sign-in and for triggering the Supabase reset email; the server-side
 * gates/audits live in lib/auth/*. On success, navigates to /dashboard.
 */
import { useEffect, useState } from "react";
import { LogoWordmark } from "@/components/brand/logo";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { recordLoginAudit, loginDestination } from "@/lib/auth/actions";
import { recordPasswordResetRequest } from "@/lib/auth/password-reset";
import { t } from "@/lib/i18n";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Surface generic OAuth-callback / reset outcomes via query params, without
  // useSearchParams (avoids a Suspense boundary requirement on this page).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (code === "unauthorized") setError(t.auth.googleErrors.unauthorized);
    else if (code === "oauth") setError(t.auth.googleErrors.oauth);
    const reset = params.get("reset");
    if (reset === "success") setInfo(t.auth.reset.success);
    else if (reset === "invalid") setError(t.auth.reset.invalid);
    // Phase 6.0D — a lifecycle-blocked tenant lands here with a reason. Generic, no
    // detail beyond "unavailable"; the platform admin knows the specifics.
    const tenant = params.get("tenant");
    if (tenant === "suspended") setError("Ce compte est suspendu. Contactez votre administrateur.");
    else if (tenant === "archived") setError("Ce compte est archivé et n'est plus accessible.");
    else if (tenant === "trial_expired") setError("La période d'essai est terminée. Contactez votre administrateur.");
  }, []);

  async function onGoogle() {
    setError(null);
    setGoogleBusy(true);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (oauthError) {
        setError(t.auth.googleErrors.oauth);
        setGoogleBusy(false);
      }
      // On success the browser is redirected to Google; nothing more to do.
    } catch {
      setError(t.auth.googleErrors.oauth);
      setGoogleBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(t.auth.error);
        return;
      }
      await recordLoginAudit();
      // Route by identity: a portal client who used the staff login goes to the
      // portal, not the staff dashboard (avoids the /dashboard ⇄ /login loop).
      window.location.href = await loginDestination();
    } catch {
      setError(t.auth.error);
    } finally {
      setSubmitting(false);
    }
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResetBusy(true);
    try {
      const supabase = getBrowserSupabaseClient();
      // Trigger the Supabase reset email (PKCE; verifier stored in THIS browser).
      // Uniform behaviour for any address — Supabase silently no-ops unknown ones.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      // Internal, gated audit (only fires for an active staff email); returns nothing.
      await recordPasswordResetRequest(email);
    } catch {
      /* swallow — never reveal anything */
    } finally {
      // Always show the same generic confirmation (anti-enumeration).
      setResetSent(true);
      setResetBusy(false);
    }
  }

  function switchMode(next: "login" | "forgot") {
    setMode(next);
    setError(null);
    setInfo(null);
    setResetSent(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <LogoWordmark />
        </div>

        <div className="surface p-6">
          {mode === "forgot" ? (
            <>
              <h1 className="text-lg font-semibold text-navy-900">{t.auth.reset.title}</h1>
              <p className="mt-1 text-sm text-slate-500">{t.auth.reset.intro}</p>

              {resetSent ? (
                <p className="mt-6 rounded-lg bg-teal-50 p-2.5 text-sm text-teal-800" role="status">
                  {t.auth.reset.sent}
                </p>
              ) : (
                <form onSubmit={onForgot} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="reset-email" className="block text-sm font-medium text-navy-700">
                      {t.auth.email}
                    </label>
                    <input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={resetBusy}
                    className="w-full rounded-lg bg-navy-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
                  >
                    {resetBusy ? t.auth.reset.sending : t.auth.reset.submit}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => switchMode("login")}
                className="mt-4 text-sm text-teal-700 hover:underline"
              >
                ← {t.auth.backToLogin}
              </button>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-navy-900">{t.auth.title}</h1>
              <p className="mt-1 text-sm text-slate-500">{t.auth.subtitle}</p>

              {info && (
                <p className="mt-6 rounded-lg bg-teal-50 p-2.5 text-sm text-teal-800" role="status">
                  {info}
                </p>
              )}

              <button
                type="button"
                onClick={onGoogle}
                disabled={googleBusy || submitting}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-navy-900 hover:bg-slate-50 disabled:opacity-60"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                  <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
                </svg>
                {t.auth.google}
              </button>

              <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                {t.auth.or}
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-navy-700">
                    {t.auth.email}
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-navy-700">
                    {t.auth.password}
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                {error && (
                  <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700" role="alert">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-navy-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
                >
                  {submitting ? t.auth.submitting : t.auth.submit}
                </button>
              </form>

              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="mt-4 text-sm text-teal-700 hover:underline"
              >
                {t.auth.forgot}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

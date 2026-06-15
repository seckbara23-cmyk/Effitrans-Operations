"use client";

/**
 * Minimal login page (UI-2 / completes AUTH-1 UI).
 * ---------------------------------------------------------------------------
 * Email/password only. Generic error message (never reveals whether an email
 * exists). On success, navigates to /dashboard. Uses the browser client
 * (anon key only). No service-role, no business logic.
 */
import { useEffect, useState } from "react";
import { LogoWordmark } from "@/components/brand/logo";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { recordLoginAudit } from "@/lib/auth/actions";
import { t } from "@/lib/i18n";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Surface a generic OAuth-callback error (?error=unauthorized|oauth) without
  // useSearchParams (avoids a Suspense boundary requirement on this page).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code === "unauthorized") setError(t.auth.googleErrors.unauthorized);
    else if (code === "oauth") setError(t.auth.googleErrors.oauth);
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
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        // Generic message only — do not leak whether the email exists.
        setError(t.auth.error);
        return;
      }
      // Best-effort audit (never blocks login); session cookie is now set.
      await recordLoginAudit();
      window.location.href = "/dashboard";
    } catch {
      setError(t.auth.error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <LogoWordmark />
        </div>

        <div className="surface p-6">
          <h1 className="text-lg font-semibold text-navy-900">{t.auth.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.auth.subtitle}</p>

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
        </div>
      </div>
    </div>
  );
}

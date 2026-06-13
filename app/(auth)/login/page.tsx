"use client";

/**
 * Minimal login page (UI-2 / completes AUTH-1 UI).
 * ---------------------------------------------------------------------------
 * Email/password only. Generic error message (never reveals whether an email
 * exists). On success, navigates to /dashboard. Uses the browser client
 * (anon key only). No service-role, no business logic.
 */
import { useState } from "react";
import { LogoWordmark } from "@/components/brand/logo";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n";

export default function LoginPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

          {!configured ? (
            <p className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {t.auth.notConfigured}
            </p>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
          )}
        </div>
      </div>
    </div>
  );
}

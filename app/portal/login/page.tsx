"use client";

/**
 * Customer Portal login (Phase 1.12A). Separate from the internal /login.
 * ---------------------------------------------------------------------------
 * Email/password via the browser (anon-key) client. After sign-in, calls
 * recordPortalLogin() which verifies this IS a portal user, activates on first
 * login, and rejects staff/disabled accounts (then we sign them back out).
 */
import { useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { recordPortalLogin } from "@/lib/portal/actions";
import { t } from "@/lib/i18n";

export default function PortalLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const p = t.portal.login;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(p.error);
        return;
      }
      const res = await recordPortalLogin();
      if (!res.ok) {
        // Not a portal user / disabled — tear the session down immediately.
        await supabase.auth.signOut();
        setError(res.error === "disabled" ? p.disabled : res.error === "not_portal" ? p.notPortal : p.error);
        return;
      }
      window.location.href = "/portal";
    } catch {
      setError(p.error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-teal-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-lg font-bold text-white">{t.portal.brand}</div>
        <div className="surface p-6">
          <h1 className="text-lg font-semibold text-navy-900">{p.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{p.subtitle}</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-navy-700">{p.email}</label>
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
              <label htmlFor="password" className="block text-sm font-medium text-navy-700">{p.password}</label>
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
              <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700" role="alert">{error}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-teal-700 px-3 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? p.submitting : p.submit}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

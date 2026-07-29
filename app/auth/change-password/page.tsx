"use client";

/**
 * Staff forced password change. Client page.
 * ---------------------------------------------------------------------------
 * Where a staff user carrying `must_change_password` is sent by the staff guard
 * (lib/auth/require-user.ts) before ANY application route renders. The exact
 * counterpart of the portal's /portal/auth/change-password, and deliberately the
 * same shape: the password is set by the user's own authenticated session
 * (supabase.auth.updateUser), then the server clears the flag, clears the
 * temporary-password expiry, stamps password_changed_at and audits
 * (completeStaffPasswordChange). The session CONTINUES to /dashboard — no
 * sign-out, unlike the email-recovery flow.
 *
 * It lives under /auth, which the middleware treats as public and the route
 * contract renders without redirecting, so the guard's redirect cannot loop.
 */
import { useEffect, useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { assertStaffPasswordChange, completeStaffPasswordChange } from "@/lib/users/password-actions";
import { validateNewPassword } from "@/lib/auth/password-rules";
import { t } from "@/lib/i18n";

type Status = "verifying" | "ready" | "invalid";

export default function StaffChangePasswordPage() {
  const [status, setStatus] = useState<Status>("verifying");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = t.auth.changePassword;

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          window.location.href = "/login";
          return;
        }
        const gate = await assertStaffPasswordChange();
        if (!gate.ok) {
          await supabase.auth.signOut();
          window.location.href = "/login";
          return;
        }
        setStatus("ready");
      } catch {
        setStatus("invalid");
      }
    })();
  }, []);

  async function onUpdate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const rule = validateNewPassword(pw, pw2);
    if (rule) {
      setError(rule === "tooShort" ? c.tooShort : c.mismatch);
      return;
    }
    setBusy(true);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error: upErr } = await supabase.auth.updateUser({ password: pw });
      if (upErr) {
        setError(c.error);
        setBusy(false);
        return;
      }
      const res = await completeStaffPasswordChange();
      if (!res.ok) {
        setError(c.error);
        setBusy(false);
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError(c.error);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-lg font-bold text-white">{t.auth.subtitle}</div>
        <div className="surface p-6">
          <h1 className="text-lg font-semibold text-navy-900">{c.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{c.intro}</p>

          {status === "verifying" && <p className="mt-4 text-sm text-slate-500">{c.verifying}</p>}

          {status === "invalid" && (
            <>
              <p className="mt-4 rounded-lg bg-red-50 p-2.5 text-sm text-red-700" role="alert">{c.error}</p>
              <a href="/login" className="mt-4 inline-block text-sm text-teal-700 hover:underline">
                ← {t.auth.backToLogin}
              </a>
            </>
          )}

          {status === "ready" && (
            <form onSubmit={onUpdate} className="mt-6 space-y-4">
              <div>
                <label htmlFor="pw" className="block text-sm font-medium text-navy-700">{c.newPassword}</label>
                <input
                  id="pw"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>
              <div>
                <label htmlFor="pw2" className="block text-sm font-medium text-navy-700">{c.confirmPassword}</label>
                <input
                  id="pw2"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              {error && <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700" role="alert">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-teal-700 px-3 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {busy ? c.submitting : c.submit}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

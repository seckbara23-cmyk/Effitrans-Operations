"use client";

/**
 * Set a new password after a recovery link (Phase 1.16). Client page.
 * ---------------------------------------------------------------------------
 * The Supabase reset email links here (redirectTo). On load we establish the
 * recovery session (PKCE code exchange, or an already-detected session), then
 * GATE it server-side: only an ACTIVE app_user may proceed (assertStaffRecovery).
 * Portal / inactive / orphan sessions are signed out and bounced. On success we
 * updateUser({ password }), audit, sign out, and return to /login.
 */
import { useEffect, useState } from "react";
import { LogoWordmark } from "@/components/brand/logo";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { assertStaffRecovery, recordPasswordResetComplete } from "@/lib/auth/password-reset";
import { validateNewPassword } from "@/lib/auth/password-rules";
import { t } from "@/lib/i18n";

type Status = "verifying" | "ready" | "invalid";

export default function UpdatePasswordPage() {
  const [status, setStatus] = useState<Status>("verifying");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = t.auth.reset;

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("error")) {
          setStatus("invalid");
          return;
        }
        // PKCE: exchange the code if the client hasn't already auto-detected it.
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          const code = params.get("code");
          if (code) {
            const { error: xErr } = await supabase.auth.exchangeCodeForSession(code);
            if (xErr) {
              setStatus("invalid");
              return;
            }
          } else {
            setStatus("invalid");
            return;
          }
        }
        // Staff-only gate (active app_user by id). Non-staff are torn down.
        const gate = await assertStaffRecovery();
        if (!gate.ok) {
          await supabase.auth.signOut();
          window.location.href = "/login?reset=invalid";
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
      setError(rule === "tooShort" ? r.tooShort : r.mismatch);
      return;
    }
    setBusy(true);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error: upErr } = await supabase.auth.updateUser({ password: pw });
      if (upErr) {
        setError(r.error);
        setBusy(false);
        return;
      }
      await recordPasswordResetComplete();
      await supabase.auth.signOut();
      window.location.href = "/login?reset=success";
    } catch {
      setError(r.error);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <LogoWordmark />
        </div>

        <div className="surface p-6">
          <h1 className="text-lg font-semibold text-navy-900">{r.updateTitle}</h1>

          {status === "verifying" && <p className="mt-4 text-sm text-slate-500">{r.verifying}</p>}

          {status === "invalid" && (
            <>
              <p className="mt-4 rounded-lg bg-red-50 p-2.5 text-sm text-red-700" role="alert">{r.invalid}</p>
              <a href="/login" className="mt-4 inline-block text-sm text-teal-700 hover:underline">
                ← {t.auth.backToLogin}
              </a>
            </>
          )}

          {status === "ready" && (
            <form onSubmit={onUpdate} className="mt-6 space-y-4">
              <div>
                <label htmlFor="pw" className="block text-sm font-medium text-navy-700">{r.newPassword}</label>
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
                <label htmlFor="pw2" className="block text-sm font-medium text-navy-700">{r.confirmPassword}</label>
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

              {error && (
                <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700" role="alert">{error}</p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-navy-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
              >
                {busy ? r.updating : r.update}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

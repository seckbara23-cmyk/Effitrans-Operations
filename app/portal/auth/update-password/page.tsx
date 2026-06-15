"use client";

/**
 * Portal: set a new password after a recovery link (Phase 1.16). Client page.
 * ---------------------------------------------------------------------------
 * Portal mirror of /auth/update-password. The Supabase reset email links here.
 * We establish the recovery session (PKCE), then GATE it: only a non-DISABLED
 * client_user may proceed (assertPortalRecovery). Staff / disabled / orphan
 * sessions are signed out and bounced. On success → updateUser → audit → signOut
 * → /portal/login.
 */
import { useEffect, useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { assertPortalRecovery, recordPortalPasswordResetComplete } from "@/lib/portal/password-reset";
import { t } from "@/lib/i18n";

type Status = "verifying" | "ready" | "invalid";

export default function PortalUpdatePasswordPage() {
  const [status, setStatus] = useState<Status>("verifying");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = t.portal.login.reset;

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("error")) {
          setStatus("invalid");
          return;
        }
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
        const gate = await assertPortalRecovery();
        if (!gate.ok) {
          await supabase.auth.signOut();
          window.location.href = "/portal/login?reset=invalid";
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
    if (pw.length < 8) {
      setError(r.tooShort);
      return;
    }
    if (pw !== pw2) {
      setError(r.mismatch);
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
      await recordPortalPasswordResetComplete();
      await supabase.auth.signOut();
      window.location.href = "/portal/login?reset=success";
    } catch {
      setError(r.error);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-teal-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-lg font-bold text-white">{t.portal.brand}</div>
        <div className="surface p-6">
          <h1 className="text-lg font-semibold text-navy-900">{r.updateTitle}</h1>

          {status === "verifying" && <p className="mt-4 text-sm text-slate-500">{r.verifying}</p>}

          {status === "invalid" && (
            <>
              <p className="mt-4 rounded-lg bg-red-50 p-2.5 text-sm text-red-700" role="alert">{r.invalid}</p>
              <a href="/portal/login" className="mt-4 inline-block text-sm text-teal-700 hover:underline">
                ← {t.portal.login.backToLogin}
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
                className="w-full rounded-lg bg-teal-700 px-3 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
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

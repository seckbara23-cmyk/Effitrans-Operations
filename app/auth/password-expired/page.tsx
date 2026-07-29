"use client";

/**
 * Terminal notice: the temporary password has expired. Client page.
 * ---------------------------------------------------------------------------
 * A DEAD END, on purpose. There is no form here and no way forward from this
 * screen, because an expired temporary password must not be exchangeable for a
 * permanent one — that would make the expiry decorative. The credential is
 * finished; only a new administrative issue (audited, with a stated reason) can
 * restore access.
 *
 * The signed-in session is what got the user here, so the page offers a real
 * sign-out rather than a link back to /login that the middleware would bounce
 * straight to /dashboard, where the guard would return them here.
 */
import { useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n";

export default function StaffPasswordExpiredPage() {
  const [busy, setBusy] = useState(false);
  const c = t.auth.passwordExpired;

  async function signOut() {
    setBusy(true);
    try {
      await getBrowserSupabaseClient().auth.signOut();
    } catch {
      /* sign out locally regardless — the destination is the login page either way */
    }
    window.location.href = "/login";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-lg font-bold text-white">{t.auth.subtitle}</div>
        <div className="surface p-6">
          <h1 className="text-lg font-semibold text-navy-900">{c.title}</h1>
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            {c.intro}
          </p>
          <p className="mt-3 text-sm text-slate-600">{c.whatNow}</p>
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-navy-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
          >
            {c.signOut}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * Driver mobile shell (Phase 3.4C). Client component — mobile-first chrome for
 * the /driver surface. No staff navigation is ever rendered here. Sign-out tears
 * down the Supabase session and returns to /login.
 */
import Link from "next/link";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { recordLogoutAudit } from "@/lib/auth/actions";
import { t } from "@/lib/i18n";

export function DriverShell({ children }: { children: React.ReactNode }) {
  const d = t.driver;
  async function signOut() {
    try {
      await recordLogoutAudit();
    } catch {
      /* best-effort */
    }
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }
  return (
    <div className="min-h-screen bg-sand-100">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-navy-800 bg-navy-900 px-4 py-3 text-white">
        <Link href="/driver" className="text-sm font-semibold tracking-tight">
          {d.appName}
        </Link>
        <button onClick={signOut} className="rounded-md px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/10">
          {d.nav.logout}
        </button>
      </header>
      <main className="mx-auto w-full max-w-md px-4 py-4">{children}</main>
    </div>
  );
}

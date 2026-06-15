"use client";

/**
 * Customer Portal shell (Phase 1.12A) — its own chrome, no internal nav.
 */
import Link from "next/link";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n";

export function PortalShell({
  clientName,
  children,
}: {
  clientName: string | null;
  children: React.ReactNode;
}) {
  async function signOut() {
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = "/portal/login";
  }

  return (
    <div className="min-h-screen bg-sand-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="font-bold text-teal-800">{t.portal.brand}</span>
          <nav className="ml-2 flex gap-3 text-sm text-slate-600">
            <Link href="/portal" className="hover:text-teal-700">{t.portal.nav.dashboard}</Link>
            <Link href="/portal/files" className="hover:text-teal-700">{t.portal.nav.files}</Link>
          </nav>
          {clientName && <span className="ml-auto text-sm font-medium text-navy-900">{clientName}</span>}
          <button
            onClick={signOut}
            className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-slate-50"
          >
            {t.portal.nav.signOut}
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}

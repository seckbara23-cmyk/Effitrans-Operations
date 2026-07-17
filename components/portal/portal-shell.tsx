"use client";

/**
 * Customer Portal shell (Phase 1.12A) — its own chrome, no internal nav.
 */
import Link from "next/link";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { t } from "@/lib/i18n";

export function PortalShell({
  clientName,
  brandName,
  children,
}: {
  clientName: string | null;
  /** tenant-resolved portal brand; falls back to the default portal label */
  brandName?: string;
  children: React.ReactNode;
}) {
  async function signOut() {
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = "/portal/login";
  }

  return (
    <div className="min-h-screen bg-sand-100">
      {/* 8.3 — the portal keeps its simple wrapping header (5 destinations, no drawer needed)
          but every link/button becomes a ≥44px touch target and the bar respects the notch. */}
      <header className="border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-1 gap-y-0 px-4 py-2">
          <span className="py-2 font-bold text-teal-800">{brandName ?? t.portal.brand}</span>
          <nav className="ml-1 flex flex-wrap text-sm text-slate-600" aria-label="Navigation du portail">
            <Link href="/portal" className="flex min-h-[44px] items-center px-2.5 hover:text-teal-700">{t.portal.nav.dashboard}</Link>
            <Link href="/portal/files" className="flex min-h-[44px] items-center px-2.5 hover:text-teal-700">{t.portal.nav.files}</Link>
            <Link href="/portal/documents" className="flex min-h-[44px] items-center px-2.5 hover:text-teal-700">{t.portal.nav.documents}</Link>
            <Link href="/portal/invoices" className="flex min-h-[44px] items-center px-2.5 hover:text-teal-700">{t.portal.nav.invoices}</Link>
            <Link href="/portal/notifications" className="flex min-h-[44px] items-center px-2.5 hover:text-teal-700">{t.portal.nav.notifications}</Link>
          </nav>
          {clientName && <span className="ml-auto hidden text-sm font-medium text-navy-900 sm:inline">{clientName}</span>}
          <button
            onClick={signOut}
            className="ml-auto min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-slate-50 sm:ml-2"
          >
            {t.portal.nav.signOut}
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</main>
    </div>
  );
}

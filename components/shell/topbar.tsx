"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { allNavItems, newDossierAction } from "@/lib/nav";
import { t } from "@/lib/i18n";
import { IconMenu, IconSearch, IconPlus } from "@/lib/icons";
import { useSession, canSeeNav } from "@/lib/auth/use-session";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { recordLogoutAudit } from "@/lib/auth/actions";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { PwaInstallAction } from "@/components/pwa/pwa-install-action";

function currentTitle(pathname: string): string {
  const match = allNavItems.find(
    (i) =>
      pathname === i.href ||
      (i.href !== "/dashboard" && pathname.startsWith(i.href)),
  );
  return match?.label ?? t.app.short;
}

export function Topbar({
  onOpenMenu,
  roleLabel,
}: {
  onOpenMenu: () => void;
  /** The user's role, in French. Resolved on the server; never a raw role code. */
  roleLabel?: string | null;
}) {
  const pathname = usePathname();
  const title = currentTitle(pathname);
  const session = useSession();

  async function signOut() {
    const supabase = getBrowserSupabaseClient();
    // Audit before signing out, while the session still resolves the user.
    await recordLogoutAudit();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-sand-50/85 backdrop-blur supports-[backdrop-filter]:bg-sand-50/70">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <button
          onClick={onOpenMenu}
          className="rounded-md p-2 text-navy-700 hover:bg-slate-200/60 lg:hidden"
          aria-label="Ouvrir le menu"
        >
          <IconMenu />
        </button>

        <div className="hidden min-w-0 sm:block">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
            {session.brandName ?? t.app.company}
          </p>
          <h1 className="truncate text-base font-semibold text-navy-900">
            {title}
          </h1>
        </div>

        {/* Search */}
        <div className="ml-auto flex flex-1 items-center justify-end gap-2 sm:gap-3">
          <div className="relative hidden max-w-sm flex-1 md:block">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder={t.topbar.search}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-navy-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          {/* Workspace switcher (6.0H) — renders only when there is more than one
              destination (a platform admin with a tenant, or multiple memberships). */}
          <WorkspaceSwitcher variant="tenant" />

          <NotificationBell />

          {canSeeNav(newDossierAction.permission, session) && (
            <Link
              href={newDossierAction.href}
              className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-navy-800"
            >
              <IconPlus className="h-4 w-4" />
              <span className="hidden sm:inline">{t.topbar.newFile}</span>
            </Link>
          )}

          {/* Phase 8.5 — compact install action. Renders nothing unless installable
              (flag on, not already installed, browser supports it); the small header
              action is the fallback placement since this shell has no account/profile
              dropdown to host it in (audited: identity block below is flat, not a menu). */}
          <PwaInstallAction />

          {session.configured && session.email && (
            <div className="flex items-center gap-2 border-l border-slate-200 pl-2 sm:pl-3">
              {/* Contextual identity (5.0E-1, Deliverable 8): who you are and what
                  you are here to do. A role CODE is never printed. */}
              <span className="hidden min-w-0 leading-tight md:block">
                <span className="block max-w-[18ch] truncate text-sm text-slate-600" title={session.email}>
                  {session.email}
                </span>
                {roleLabel && (
                  <span className="block max-w-[18ch] truncate text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                    {roleLabel}
                  </span>
                )}
              </span>
              <button
                onClick={signOut}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-navy-700 hover:bg-slate-50"
              >
                {t.topbar.signOut}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

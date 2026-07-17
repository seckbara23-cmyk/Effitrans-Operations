"use client";

/**
 * Platform administration shell (Phase 4.0B-4; mobile drawer added in 8.3). CLIENT.
 * ---------------------------------------------------------------------------
 * A distinct shell for the platform surface — platform-branded, with the platform
 * nav only. It receives the resolved platform user from the server layout (which
 * enforces the authorization boundary), so it needs no tenant session context and
 * can never render tenant navigation.
 *
 * 8.3: below lg the sidebar was simply hidden, leaving the platform nav UNREACHABLE on
 * phones/tablets. The same nav now renders as an accessible drawer (shared a11y hook:
 * focus trap, Escape, focus restore, scroll lock; closes on route change) behind a
 * hamburger in the sticky header. One nav definition — no duplicated destinations.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { visiblePlatformNav } from "@/lib/platform/nav";
import { PLATFORM_BRANDING } from "@/lib/branding/platform";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { useDialogA11y } from "@/lib/ui/use-dialog-a11y";

export function PlatformShell({
  email,
  role,
  permissions,
  children,
}: {
  email: string;
  role: string;
  permissions: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const items = visiblePlatformNav(permissions);
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useDialogA11y(menuOpen, () => setMenuOpen(false));
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      setMenuOpen(false);
    }
  }, [pathname]);

  async function signOut() {
    await getBrowserSupabaseClient().auth.signOut();
    window.location.href = "/login";
  }

  const brand = (
    <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-sm font-bold text-white">EP</span>
      <div className="leading-tight">
        <p className="text-[15px] font-bold text-white">{PLATFORM_BRANDING.displayName}</p>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-300">Administration</p>
      </div>
    </div>
  );

  const nav = (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5" aria-label="Navigation plateforme">
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== "/platform" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "block min-h-[44px] rounded-lg px-3 py-2.5 text-[15px] font-semibold transition-colors",
              active ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <p className="truncate text-[13px] font-semibold text-white">{email}</p>
      <p className="mb-3 truncate text-[12px] font-medium text-teal-300">{role}</p>
      {/* Workspace switcher (6.0H) — jump to a tenant workspace the admin belongs to.
          Renders only when there is somewhere to switch to. */}
      <div className="mb-3">
        <WorkspaceSwitcher variant="platform" />
      </div>
      <button
        onClick={signOut}
        className="min-h-[44px] w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
      >
        Se déconnecter
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-white/10 bg-navy-950 lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {/* 8.3 — mobile drawer (same nav definition, dialog semantics via the shared hook). */}
      <div
        className={cn("fixed inset-0 z-50 lg:hidden", menuOpen ? "pointer-events-auto" : "pointer-events-none")}
        aria-hidden={!menuOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-300",
            menuOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setMenuOpen(false)}
        />
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation plateforme"
          tabIndex={-1}
          className={cn(
            "absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-navy-950 shadow-2xl transition-transform duration-300 ease-out",
            menuOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between">
            {brand}
            <button
              onClick={() => setMenuOpen(false)}
              className="mr-3 min-h-[44px] min-w-[44px] rounded-md p-2 text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              aria-label="Fermer le menu"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {nav}
          {footer}
        </div>
      </div>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-navy-950/80 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-5">
            <button
              onClick={() => setMenuOpen(true)}
              className="min-h-[44px] min-w-[44px] rounded-md p-2 text-slate-200 hover:bg-white/10 lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-300">{PLATFORM_BRANDING.displayName}</p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 text-slate-100 sm:px-5 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

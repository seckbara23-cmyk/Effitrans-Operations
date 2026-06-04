"use client";

import { usePathname } from "next/navigation";
import { allNavItems } from "@/lib/nav";
import { t } from "@/lib/i18n";
import { IconMenu, IconSearch, IconBell, IconPlus } from "@/lib/icons";

function currentTitle(pathname: string): string {
  const match = allNavItems.find(
    (i) =>
      pathname === i.href ||
      (i.href !== "/dashboard" && pathname.startsWith(i.href)),
  );
  return match?.label ?? t.app.short;
}

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const title = currentTitle(pathname);

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
            {t.app.company}
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

          <button
            className="relative rounded-lg border border-slate-200 bg-white p-2 text-navy-700 hover:bg-slate-50"
            aria-label={t.topbar.notifications}
          >
            <IconBell className="h-5 w-5" />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
          </button>

          <button className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-navy-800">
            <IconPlus className="h-4 w-4" />
            <span className="hidden sm:inline">{t.topbar.newFile}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

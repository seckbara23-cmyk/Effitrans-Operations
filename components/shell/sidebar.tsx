"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navSections } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { LogoWordmark } from "@/components/brand/logo";
import { IconClose } from "@/lib/icons";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-7 overflow-y-auto px-3 py-6">
      {navSections.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-teal-300">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" &&
                  pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                      active
                        ? "bg-white/15 text-white shadow-sm"
                        : "text-slate-100 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {active && (
                      <span className="absolute inset-y-1 left-0 w-1 rounded-r-full bg-amber-400" />
                    )}
                    <Icon
                      className={cn(
                        "h-5 w-5 shrink-0 transition-colors",
                        active
                          ? "text-amber-400"
                          : "text-slate-200 group-hover:text-teal-200",
                      )}
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  return (
    <div className="border-t border-white/10 px-4 py-4">
      <div className="flex items-center gap-3 rounded-lg bg-white/[0.07] p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500 text-sm font-semibold text-white ring-1 ring-inset ring-white/15">
          AN
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-white">Awa Ndiaye</p>
          <p className="truncate text-xs font-medium text-teal-300">
            Responsable opérations
          </p>
        </div>
      </div>
    </div>
  );
}

const surface =
  "flex h-full flex-col bg-navy-900 route-lines border-r border-white/5";

/** Desktop sidebar — fixed, always visible on lg+. */
export function DesktopSidebar() {
  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-72 lg:flex-col">
      <div className={surface}>
        <div className="flex h-16 items-center border-b border-white/10 px-4">
          <LogoWordmark />
        </div>
        <NavLinks />
        <SidebarFooter />
      </div>
    </aside>
  );
}

/** Mobile drawer — slides in over a scrim. */
export function MobileSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 lg:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "absolute inset-0 bg-navy-950/60 backdrop-blur-sm transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className={surface}>
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
            <LogoWordmark subtitle={false} />
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
              aria-label="Fermer le menu"
            >
              <IconClose />
            </button>
          </div>
          <NavLinks onNavigate={onClose} />
          <SidebarFooter />
        </div>
      </div>
    </div>
  );
}

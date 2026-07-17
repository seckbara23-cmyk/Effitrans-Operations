"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useDialogA11y } from "@/lib/ui/use-dialog-a11y";
import type { NavigationSection, NavIconKey } from "@/lib/navigation/types";
import {
  IconStar,
  IconTower,
  IconStamp,
  IconTruck,
  IconFinance,
  IconDocument,
  IconBuilding,
  IconUsers,
  IconContainer,
  IconBell,
  IconReport,
  IconClose,
} from "@/lib/icons";
import { cn } from "@/lib/cn";
import { LogoWordmark } from "@/components/brand/logo";
import { t } from "@/lib/i18n";
import { useSession, canSeeNav } from "@/lib/auth/use-session";

/** Icon KEYS cross the server→client boundary; components cannot. */
const ICONS: Record<NavIconKey, typeof IconTower> = {
  star: IconStar,
  tower: IconTower,
  stamp: IconStamp,
  truck: IconTruck,
  finance: IconFinance,
  document: IconDocument,
  building: IconBuilding,
  users: IconUsers,
  container: IconContainer,
  bell: IconBell,
  report: IconReport,
};

/**
 * Phase 5.0E-1: on the role-aware path the sidebar no longer decides what is
 * visible. It used to merge a static section list with a process section list and
 * filter both through `canSeeNav` — three places deciding one thing, and they had
 * already drifted.
 *
 * When `filtered` is true the server already knew who was asking and handed us
 * exactly what they may see, so we render it verbatim. When it is false we are on
 * the legacy (workspaces-off) path, where the layout deliberately resolves no
 * session — so we apply the same cosmetic filter we have applied since Phase 2.0.
 * Either way the routes re-check server-side; nothing here is load-bearing.
 */
function NavLinks({
  sections,
  filtered,
  onNavigate,
}: {
  sections: NavigationSection[];
  filtered: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const session = useSession();

  const visible = filtered
    ? sections
    : sections
        .map((s) => ({ ...s, items: s.items.filter((i) => canSeeNav(i.permission, session)) }))
        .filter((s) => s.items.length > 0);

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Navigation principale">
      {visible.map((section) => (
        <div key={section.key}>
          <p className="px-3 pb-2.5 text-xs font-bold uppercase tracking-[0.2em] text-teal-300">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              // /dashboard is a prefix of /dashboard/executive, so it must match
              // exactly; every other entry highlights across its subtree.
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
              const Icon = ICONS[item.iconKey];
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={item.hint}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-semibold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
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
                        "h-[22px] w-[22px] shrink-0 transition-colors",
                        active ? "text-amber-400" : "text-slate-200 group-hover:text-teal-200",
                      )}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {typeof item.badge === "number" && item.badge > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold leading-none text-navy-900"
                        aria-label={`${item.badge} en attente`}
                      >
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
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

function SidebarFooter({ roleLabel }: { roleLabel?: string | null }) {
  const session = useSession();

  const signedIn = session.configured && session.email;
  const name = signedIn ? session.email! : "Awa Ndiaye";
  // The user's ROLE, in French. Never a raw role code (Deliverable 8).
  const subtitle = roleLabel ?? (signedIn ? t.topbar.account : "Responsable opérations");
  const initials = signedIn ? session.email!.slice(0, 2).toUpperCase() : "AN";

  return (
    <div className="border-t border-white/10 px-4 py-4">
      <div className="flex items-center gap-3 rounded-lg bg-white/[0.07] p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500 text-sm font-semibold text-white ring-1 ring-inset ring-white/15">
          {initials}
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-semibold text-white">{name}</p>
          <p className="truncate text-[13px] font-medium text-teal-300">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

const surface = "flex h-full flex-col bg-navy-900 route-lines border-r border-white/5";

type SidebarProps = {
  sections: NavigationSection[];
  /** Whether the server already filtered `sections` for this user. */
  filtered: boolean;
  roleLabel?: string | null;
};

/** Desktop sidebar — fixed, always visible on lg+. */
export function DesktopSidebar({ sections, filtered, roleLabel }: SidebarProps) {
  const session = useSession();
  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-72 lg:flex-col">
      <div className={surface}>
        <div className="flex h-16 items-center border-b border-white/10 px-4">
          <LogoWordmark brandName={session.brandName ?? undefined} tagline={session.tagline ?? undefined} />
        </div>
        <NavLinks sections={sections} filtered={filtered} />
        <SidebarFooter roleLabel={roleLabel} />
      </div>
    </aside>
  );
}

/** Mobile drawer — slides in over a scrim. 8.3: full dialog semantics via the SHARED a11y
 *  hook (focus trap, Escape, focus restore, body scroll lock) + closes on route change. */
export function MobileSidebar({
  open,
  onClose,
  sections,
  filtered,
  roleLabel,
}: SidebarProps & { open: boolean; onClose: () => void }) {
  const session = useSession();
  const dialogRef = useDialogA11y(open, onClose);
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      if (open) onClose();
    }
  }, [pathname, open, onClose]);

  return (
    <div
      className={cn("fixed inset-0 z-50 lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")}
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation principale"
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 left-0 w-72 max-w-[85%] pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className={surface}>
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
            <LogoWordmark subtitle={false} brandName={session.brandName ?? undefined} tagline={session.tagline ?? undefined} />
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              aria-label="Fermer le menu"
            >
              <IconClose />
            </button>
          </div>
          <NavLinks sections={sections} filtered={filtered} onNavigate={onClose} />
          <SidebarFooter roleLabel={roleLabel} />
        </div>
      </div>
    </div>
  );
}

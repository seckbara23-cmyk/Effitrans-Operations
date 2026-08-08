"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * EMP-1 — sub-navigation for the mail workspace.
 *
 * Phase 7.2C's lesson: the main sidebar is frozen, so a workspace made of
 * several routes needs its own nested layout or its surfaces become
 * unreachable. Communications had exactly that problem — the triage queue
 * existed but nothing linked to it from the outbound log.
 *
 * The tabs are rendered from what the caller says the user may see. An
 * unreachable tab is absent rather than shown-and-refused.
 */
export type MailTab = { href: string; label: string };

export function MailNav({ tabs }: { tabs: MailTab[] }) {
  const pathname = usePathname();
  if (tabs.length < 2) return null;

  return (
    <nav aria-label="Sections du courrier" className="mb-4 flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
      {tabs.map((tab) => {
        // The outbound log lives at the root, so it must match exactly or it
        // would light up on every child route.
        const active =
          tab.href === "/mail"
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition",
              active
                ? "bg-navy-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

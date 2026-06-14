"use client";

/**
 * Notification bell + popover (Phase 1.6). Client component.
 * ---------------------------------------------------------------------------
 * Loads the caller's feed via server actions (self-scoped, no service role in
 * the client bundle). Shows an unread badge; the popover lists recent items,
 * each linking to its dossier and marking itself read on click. "Mark all read"
 * clears the badge. Popover-only — no full /notifications page this phase.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconBell } from "@/lib/icons";
import { t } from "@/lib/i18n";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import type { NotificationFeed } from "@/lib/notifications/types";

export function NotificationBell() {
  const [feed, setFeed] = useState<NotificationFeed>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetchNotifications()
      .then(setFeed)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Close the popover on an outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function onOpenToggle() {
    const next = !open;
    setOpen(next);
    if (next) load();
  }

  async function onItem(id: string) {
    await markNotificationRead(id);
    load();
    setOpen(false);
  }

  async function onMarkAll() {
    await markAllNotificationsRead();
    load();
  }

  const badge = feed.unread > 9 ? "9+" : String(feed.unread);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={onOpenToggle}
        className="relative rounded-lg border border-slate-200 bg-white p-2 text-navy-700 hover:bg-slate-50"
        aria-label={t.topbar.notifications}
      >
        <IconBell className="h-5 w-5" />
        {feed.unread > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-navy-900">{t.notifications.title}</p>
            {feed.unread > 0 && (
              <button onClick={onMarkAll} className="text-xs font-medium text-teal-700 hover:underline">
                {t.notifications.markAllRead}
              </button>
            )}
          </div>

          {feed.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">{t.notifications.empty}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {feed.items.map((n) => {
                const unread = !n.readAt;
                const inner = (
                  <div className="flex gap-2 px-4 py-3 hover:bg-slate-50">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-amber-500" : "bg-transparent"}`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className={`truncate text-sm ${unread ? "font-semibold text-navy-900" : "text-slate-600"}`}>
                        {n.title}
                      </p>
                      {n.body && <p className="truncate text-xs text-slate-500">{n.body}</p>}
                      <p className="mt-0.5 text-[11px] text-slate-400">{n.createdAt.slice(0, 10)}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.fileId ? (
                      <Link href={`/files/${n.fileId}`} onClick={() => onItem(n.id)} className="block">
                        {inner}
                      </Link>
                    ) : (
                      <button onClick={() => onItem(n.id)} className="block w-full text-left">
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { markClientNotificationRead, markAllClientNotificationsRead } from "@/lib/customer-notify/actions";
import type { ClientNotificationItem } from "@/lib/customer-notify/service";

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function PortalNotifications({ items }: { items: ClientNotificationItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const c = t.portal.notify.center;
  const unread = items.filter((i) => !i.readAt).length;

  const read = (id: string) =>
    start(async () => {
      await markClientNotificationRead(id);
      router.refresh();
    });
  const readAll = () =>
    start(async () => {
      await markAllClientNotificationsRead();
      router.refresh();
    });

  if (items.length === 0) {
    return <div className="surface p-6 text-sm text-slate-500">{c.empty}</div>;
  }

  return (
    <div className="space-y-3">
      {unread > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">{unread} {c.unread}</span>
          <button disabled={pending} onClick={readAll} className="text-sm font-medium text-teal-700 hover:underline disabled:opacity-50">
            {c.markAllRead}
          </button>
        </div>
      )}
      <div className="surface divide-y divide-slate-100">
        {items.map((it) => (
          <div key={it.id} className={`flex flex-wrap items-start gap-2 p-4 ${it.readAt ? "" : "bg-teal-50/40"}`}>
            <div className="min-w-0 flex-1">
              <p className={`text-sm ${it.readAt ? "text-navy-800" : "font-semibold text-navy-900"}`}>{it.title}</p>
              <p className="mt-0.5 text-sm text-slate-600">{it.body}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                <span>{fmt(it.createdAt)}</span>
                {it.fileId && <Link href={`/portal/files/${it.fileId}`} className="text-teal-700 hover:underline">{c.relatedFile}</Link>}
                {it.invoiceId && <Link href={`/portal/invoices/${it.invoiceId}`} className="text-teal-700 hover:underline">{c.relatedInvoice}</Link>}
              </p>
            </div>
            {!it.readAt && (
              <button disabled={pending} onClick={() => read(it.id)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50">
                {c.markRead}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

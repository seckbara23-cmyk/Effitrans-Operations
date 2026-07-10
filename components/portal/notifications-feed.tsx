import { t } from "@/lib/i18n";
import { relativeLabel } from "@/lib/portal/progress-map";
import type { ClientNotificationItem } from "@/lib/customer-notify/service";

const CATEGORY_ICON: Record<string, string> = {
  DOCUMENT: "📄",
  CUSTOMS: "🛃",
  TRANSPORT: "🚚",
  FINANCE: "💳",
  DELIVERY: "📦",
};

/** Smart notifications timeline (Phase 3.3 D6). Newest first; derived from existing activity. */
export function NotificationsFeed({ items }: { items: ClientNotificationItem[] }) {
  const nc = t.portal.notify.center;
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-500">
        {nc.empty}
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((n) => (
        <li
          key={n.id}
          className={`flex items-start gap-3 rounded-2xl border p-3 shadow-sm transition ${
            n.readAt ? "border-slate-200 bg-white" : "border-teal-200 bg-teal-50/40"
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-base" aria-hidden>
            {CATEGORY_ICON[(n.category ?? "").toUpperCase()] ?? "✔"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-navy-900">{n.title}</p>
            {n.body && <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>}
          </div>
          <span className="shrink-0 text-[11px] text-slate-400">{relativeLabel(n.createdAt, new Date())}</span>
        </li>
      ))}
    </ul>
  );
}

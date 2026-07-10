import { t } from "@/lib/i18n";
import { formatDayMonth } from "@/lib/portal/shipment-view";

export type TimelineEntry = { id: string; title: string; date: string; category?: string };

const CATEGORY_ICON: Record<string, string> = {
  DOCUMENT: "📄",
  CUSTOMS: "🛃",
  TRANSPORT: "🚚",
  FINANCE: "💳",
  DELIVERY: "📦",
};

/**
 * Chronological shipment history (Phase 3.3 D3) — dated, newest first. Consumes
 * the EXISTING customer notification/activity feed; no new event storage.
 */
export function DossierTimeline({ entries }: { entries: TimelineEntry[] }) {
  const P = t.portal.progress;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <h2 className="mb-4 text-sm font-semibold text-navy-900">{P.activityTitle}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">{t.portal.notify.center.empty}</p>
      ) : (
        <ol className="relative space-y-4 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-slate-200">
          {entries.map((e) => (
            <li key={e.id} className="relative flex gap-3 pl-0">
              <span className="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs ring-2 ring-white">
                <span aria-hidden>{CATEGORY_ICON[(e.category ?? "").toUpperCase()] ?? "✔"}</span>
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-xs font-medium text-slate-400">{formatDayMonth(e.date)}</p>
                <p className="text-sm text-navy-900">{e.title}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

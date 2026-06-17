import Link from "next/link";
import { t } from "@/lib/i18n";
import type { ActivityItem } from "@/lib/activity/feed";
import type { ActivityCategory } from "@/lib/activity/classify";

const BADGE: Record<ActivityCategory, string> = {
  user: "bg-slate-100 text-slate-600",
  document: "bg-sky-50 text-sky-700",
  customs: "bg-amber-50 text-amber-700",
  transport: "bg-teal-50 text-teal-700",
  finance: "bg-navy-50 text-navy-700",
  handoff: "bg-violet-50 text-violet-700",
  comms: "bg-slate-100 text-slate-600",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/** "Activité récente" — last few meaningful events from the audit log. */
export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-navy-900">{t.dashboard.recentActivity.title}</h2>
      {items.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">{t.dashboard.recentActivity.empty}</div>
      ) : (
        <div className="surface divide-y divide-slate-100">
          {items.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[it.category]}`}>{it.label}</span>
              {it.fileId ? (
                <Link href={`/files/${it.fileId}`} className="tabular text-teal-700 hover:underline">
                  {it.fileNumber ?? "dossier"}
                </Link>
              ) : (
                it.fileNumber && <span className="tabular text-slate-600">{it.fileNumber}</span>
              )}
              {it.clientName && <span className="text-slate-500">· {it.clientName}</span>}
              <span className="ml-auto whitespace-nowrap text-xs text-slate-400">
                {it.actorEmail ? `${it.actorEmail} · ` : ""}
                {fmt(it.occurredAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

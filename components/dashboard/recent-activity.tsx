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

// Department grouping (Phase 2.2 D7). user/handoff/comms fall under "Autres".
type Group = "documentation" | "customs" | "transport" | "finance" | "other";
const GROUP_OF: Record<ActivityCategory, Group> = {
  document: "documentation",
  customs: "customs",
  transport: "transport",
  finance: "finance",
  user: "other",
  handoff: "other",
  comms: "other",
};
const GROUP_ORDER: Group[] = ["documentation", "customs", "transport", "finance", "other"];
const groupLabel = (g: Group) =>
  g === "other" ? "Autres" : (t.lifecycle.departments as Record<string, string>)[g] ?? g;

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function Row({ it }: { it: ActivityItem }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-sm">
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
  );
}

/** "Activité récente" — recent audit events grouped by department (Phase 2.2 D7). */
export function RecentActivity({ items }: { items: ActivityItem[] }) {
  const groups = new Map<Group, ActivityItem[]>();
  for (const it of items) {
    const g = GROUP_OF[it.category];
    const arr = groups.get(g) ?? [];
    arr.push(it);
    groups.set(g, arr);
  }
  const present = GROUP_ORDER.filter((g) => (groups.get(g)?.length ?? 0) > 0);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-navy-900">{t.dashboard.recentActivity.title}</h2>
      {items.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">{t.dashboard.recentActivity.empty}</div>
      ) : (
        <div className="space-y-4">
          {present.map((g) => (
            <div key={g} className="surface overflow-hidden">
              <p className="border-b border-slate-100 bg-sand-50/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {groupLabel(g)}
              </p>
              <div className="divide-y divide-slate-100">
                {groups.get(g)!.map((it) => (
                  <Row key={it.id} it={it} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

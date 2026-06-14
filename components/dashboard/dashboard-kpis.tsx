/**
 * Real dashboard KPI band (Phase 1.5). Presentational — the page fetches the
 * data (file:read for dossier counts, task:read for task counts) and passes it
 * in, so each half degrades independently. Every card deep-links into /files
 * or /tasks with the matching filter.
 */
import Link from "next/link";
import type { FileOverview } from "@/lib/files/aggregate";
import { t } from "@/lib/i18n";

export type TaskKpis = { dueToday: number; overdue: number; mine: number };

type Card = { key: string; label: string; value: number; href: string; accent: string };

export function DashboardKpis({
  files,
  tasks,
}: {
  files: FileOverview | null;
  tasks: TaskKpis | null;
}) {
  if (!files && !tasks) return null;
  const k = t.dashboard.overview.kpi;

  const cards: Card[] = [];
  if (files) {
    cards.push(
      { key: "active", label: k.active, value: files.active, href: "/files", accent: "text-teal-700" },
      { key: "opened", label: k.opened, value: files.opened, href: "/files?status=OPENED", accent: "text-sky-700" },
      { key: "inProgress", label: k.inProgress, value: files.inProgress, href: "/files?status=IN_PROGRESS", accent: "text-amber-700" },
      { key: "delivered", label: k.delivered, value: files.delivered, href: "/files?status=DELIVERED", accent: "text-teal-700" },
      { key: "closed", label: k.closed, value: files.closed, href: "/files?status=CLOSED", accent: "text-navy-700" },
      { key: "highPriority", label: k.highPriority, value: files.highPriority, href: "/files?priority=high", accent: "text-amber-700" },
      { key: "overdueShipments", label: k.overdueShipments, value: files.overdueShipments, href: "/files?overdue=1", accent: "text-red-700" },
    );
  }
  if (tasks) {
    cards.push(
      { key: "tasksToday", label: k.tasksToday, value: tasks.dueToday, href: "/tasks", accent: "text-amber-700" },
      { key: "tasksOverdue", label: k.tasksOverdue, value: tasks.overdue, href: "/tasks?filter=overdue", accent: "text-red-700" },
      { key: "tasksMine", label: k.tasksMine, value: tasks.mine, href: "/tasks?filter=mine", accent: "text-sky-700" },
    );
  }

  return (
    <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
      {cards.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          className="surface group p-4 transition hover:border-teal-300 hover:shadow-card"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
          <p className={`mt-2 text-2xl font-bold tabular ${c.accent}`}>{c.value}</p>
        </Link>
      ))}
    </section>
  );
}

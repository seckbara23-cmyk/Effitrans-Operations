/**
 * Real Tasks section for the dashboard (Phase 1.3; presentational since 1.5).
 * Renders Overdue / Today / Mine from data the page fetched. Hidden when the
 * user lacks task:read or Supabase is unconfigured (page passes null).
 */
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { DashboardTasks as DashboardTasksData, TaskListItem } from "@/lib/tasks/types";

function Column({ title, tone, items }: { title: string; tone: string; items: TaskListItem[] }) {
  return (
    <div className="surface p-4">
      <p className={`mb-3 text-xs font-bold uppercase tracking-wide ${tone}`}>
        {title} <span className="text-slate-400">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{t.tasks.empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 8).map((task) => (
            <li key={task.id} className="text-sm">
              <Link href={`/files/${task.fileId}`} className="font-medium text-navy-900 hover:text-teal-700">
                {task.title}
              </Link>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {task.fileNumber && <span className="tabular">{task.fileNumber}</span>}
                {task.dueAt && <span>· {task.dueAt.slice(0, 10)}</span>}
                <span>· {t.tasks.priorities[task.priority]}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DashboardTasks({ data }: { data: DashboardTasksData | null }) {
  if (!data) return null; // no task:read / unconfigured — hide the section

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">{t.nav.tasks}</h2>
        <Link href="/tasks" className="text-xs font-medium text-teal-700 hover:underline">
          {t.dashboard.panels.viewAll}
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Column title={t.tasks.dashboard.overdue} tone="text-red-600" items={data.overdue} />
        <Column title={t.tasks.dashboard.today} tone="text-amber-600" items={data.today} />
        <Column title={t.tasks.dashboard.mine} tone="text-sky-600" items={data.mine} />
      </div>
    </section>
  );
}

import Link from "next/link";
import { t } from "@/lib/i18n";
import { IconChevronRight } from "@/lib/icons";
import type { DepartmentCardData } from "@/lib/departments/dashboard-map";

/** "Activité par département" — workload at a glance, links to each workspace. */
export function DepartmentCards({ cards }: { cards: DepartmentCardData[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-navy-900">{t.dashboard.deptActivity.title}</h2>
      {cards.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">{t.dashboard.deptActivity.empty}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              className="surface group block p-4 transition-shadow hover:shadow-card-hover"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.title}</p>
                <IconChevronRight className="h-4 w-4 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="tabular text-3xl font-bold leading-none text-navy-900">{c.primary.value}</span>
                {c.alert && c.alert.value > 0 && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    {c.alert.value} {c.alert.label}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">{c.primary.label}</p>
              <p className="mt-2 text-xs text-slate-400">
                {c.secondary.label} : <span className="tabular font-medium text-navy-700">{c.secondary.value}</span>
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

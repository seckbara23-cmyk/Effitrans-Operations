/**
 * Pipeline / funnel visualization (Phase 1.13B). Server-safe, dependency-free.
 * Renders ordered stages with a count and arrows between them.
 */
import { IconChevronRight } from "@/lib/icons";
import type { Bar } from "@/lib/analytics/types";

export function Pipeline({
  title,
  stages,
  labels,
  accent = "text-teal-700",
}: {
  title: string;
  stages: Bar[];
  labels: Record<string, string>;
  accent?: string;
}) {
  return (
    <section className="surface space-y-3 p-4">
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      <div className="flex flex-wrap items-stretch gap-1">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-center">
            <div className="min-w-[5.5rem] rounded-lg border border-slate-200 bg-sand-50 px-3 py-2 text-center">
              <p className={`text-lg font-bold tabular ${accent}`}>{s.value}</p>
              <p className="text-[10px] leading-tight text-slate-500">{labels[s.label] ?? s.label}</p>
            </div>
            {i < stages.length - 1 && <IconChevronRight className="mx-0.5 h-4 w-4 shrink-0 text-slate-300" />}
          </div>
        ))}
      </div>
    </section>
  );
}

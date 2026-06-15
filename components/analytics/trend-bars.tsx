/**
 * Vertical CSS bar trend (Phase 1.13B). Server-safe, dependency-free.
 * For monthly series (revenue 12mo, new dossiers 12mo).
 */
import type { TrendPoint } from "@/lib/analytics/types";

export function TrendBars({
  title,
  points,
  format,
  accent = "bg-teal-500",
}: {
  title: string;
  points: TrendPoint[];
  format?: (n: number) => string;
  accent?: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <section className="surface space-y-3 p-4">
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      <div className="flex items-end gap-1.5" style={{ height: 120 }}>
        {points.map((p) => (
          <div key={p.month} className="flex flex-1 flex-col items-center justify-end gap-1" title={format ? format(p.value) : String(p.value)}>
            <div className={`w-full rounded-t ${accent}`} style={{ height: `${Math.max(2, (p.value / max) * 100)}%` }} />
            <span className="text-[10px] text-slate-400">{p.month.slice(5)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

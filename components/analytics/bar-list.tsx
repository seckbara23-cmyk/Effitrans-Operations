/**
 * Dependency-free horizontal bar list (Phase 1.13). Server-safe, presentational.
 * Data is pre-aggregated server-side; this only draws proportional bars.
 */
import type { Bar } from "@/lib/analytics/types";

export function BarList({
  items,
  format,
  accent = "bg-teal-500",
}: {
  items: Bar[];
  format?: (n: number) => string;
  accent?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-slate-600" title={it.label}>
            {it.label}
          </span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${accent}`} style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
          <span className="w-20 shrink-0 text-right tabular text-slate-700">
            {format ? format(it.value) : it.value.toLocaleString("fr-FR")}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Issued-vs-payments grouped bars (Phase 1.13B). Server-safe, dependency-free.
 */
import { t } from "@/lib/i18n";
import type { CollectionPoint } from "@/lib/analytics/executive";

export function CollectionsChart({
  title,
  points,
  currency,
}: {
  title: string;
  points: CollectionPoint[];
  currency: string;
}) {
  const e = t.analytics.exec;
  const max = Math.max(1, ...points.flatMap((p) => [p.issued, p.paid]));
  const money = (n: number) => `${n.toLocaleString("fr-FR")} ${currency}`;

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        <div className="flex gap-3 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-500" />{e.issued}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-teal-500" />{e.paid}</span>
        </div>
      </div>
      <div className="flex items-end gap-2" style={{ height: 120 }}>
        {points.map((p) => (
          <div key={p.month} className="flex flex-1 flex-col items-center justify-end gap-1">
            <div className="flex h-full w-full items-end justify-center gap-0.5" title={`${e.issued}: ${money(p.issued)} · ${e.paid}: ${money(p.paid)}`}>
              <div className="w-1/2 rounded-t bg-sky-500" style={{ height: `${Math.max(2, (p.issued / max) * 100)}%` }} />
              <div className="w-1/2 rounded-t bg-teal-500" style={{ height: `${Math.max(2, (p.paid / max) * 100)}%` }} />
            </div>
            <span className="text-[10px] text-slate-400">{p.month.slice(5)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

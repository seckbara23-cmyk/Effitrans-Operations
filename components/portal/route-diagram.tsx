import { t } from "@/lib/i18n";
import type { MapPhase } from "@/lib/portal/shipment-view";

const PHASES: MapPhase[] = ["port", "customs", "warehouse", "transport", "client"];
const ICON: Record<MapPhase, string> = { port: "⚓", customs: "🛃", warehouse: "🏭", transport: "🚚", client: "📍" };

/**
 * Non-geographic route diagram (Phase 3.3A). The graceful fallback shown when no
 * grounded coordinates are available — NEVER claims a live geographic position.
 */
export function RouteDiagram({ phase }: { phase: MapPhase }) {
  const m = t.portal.premium.map;
  const idx = PHASES.indexOf(phase);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="relative bg-[radial-gradient(circle_at_1px_1px,theme(colors.slate.200)_1px,transparent_0)] bg-[size:16px_16px] bg-gradient-to-br from-sky-50 to-teal-50 px-5 py-6">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">{m.title}</p>
        <div className="mt-5 flex items-start justify-between">
          {PHASES.map((p, i) => {
            const done = i < idx;
            const current = i === idx;
            return (
              <div key={p} className="flex flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  <div className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : i <= idx ? "bg-teal-500" : "bg-slate-200"}`} />
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base shadow-sm ring-2 ${current ? "bg-navy-900 text-white ring-navy-900" : done ? "bg-teal-500 text-white ring-teal-500" : "bg-white text-slate-400 ring-slate-200"}`}>
                    <span aria-hidden>{ICON[p]}</span>
                  </div>
                  <div className={`h-0.5 flex-1 ${i === PHASES.length - 1 ? "bg-transparent" : i < idx ? "bg-teal-500" : "bg-slate-200"}`} />
                </div>
                <span className={`mt-2 text-center text-[11px] ${current ? "font-semibold text-navy-900" : "text-slate-500"}`}>
                  {(m as Record<string, string>)[p]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="border-t border-slate-100 px-5 py-2 text-center text-[11px] text-slate-400">{m.diagramNote}</p>
    </div>
  );
}

import { t } from "@/lib/i18n";
import { toMajorPhases, type MajorPhaseKey } from "@/lib/portal/shipment-view";
import type { PortalTimeline } from "@/lib/portal/progress-map";
import type { PortalStageStatus } from "@/lib/portal/progress-map";

const ICON: Record<MajorPhaseKey, string> = {
  documentation: "📄",
  customs: "🛃",
  transport: "🚢",
  delivery: "📦",
};

const NODE: Record<PortalStageStatus, string> = {
  completed: "bg-teal-600 text-white ring-teal-600",
  current: "bg-navy-900 text-white ring-navy-300",
  pending: "bg-white text-slate-400 ring-slate-200",
};
const LABEL: Record<PortalStageStatus, string> = {
  completed: "text-navy-900",
  current: "font-semibold text-navy-900",
  pending: "text-slate-400",
};
const CONNECTOR: Record<PortalStageStatus, string> = {
  completed: "bg-teal-500",
  current: "bg-teal-500",
  pending: "bg-slate-200",
};

/**
 * Horizontal shipment progress tracker (Phase 3.3 D2). A pure VIEW over the
 * existing customer timeline (toMajorPhases) — no stage recalculation. Mobile-first.
 */
export function ProgressTracker({ timeline }: { timeline: PortalTimeline }) {
  const phases = toMajorPhases(timeline.stages);
  const tr = t.portal.premium.tracker;

  return (
    <div className="w-full">
      <div className="flex items-start">
        {phases.map((ph, i) => (
          <div key={ph.key} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {/* left connector */}
              <div className={`h-1 flex-1 rounded-full ${i === 0 ? "bg-transparent" : CONNECTOR[phases[i - 1].status === "completed" ? "completed" : ph.status]}`} />
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm ring-2 ${NODE[ph.status]}`}>
                {ph.status === "completed" ? "✓" : <span aria-hidden>{ICON[ph.key]}</span>}
              </div>
              {/* right connector */}
              <div className={`h-1 flex-1 rounded-full ${i === phases.length - 1 ? "bg-transparent" : CONNECTOR[ph.status === "completed" ? "completed" : "pending"]}`} />
            </div>
            <span className={`mt-2 text-center text-[11px] sm:text-xs ${LABEL[ph.status]}`}>{tr[ph.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

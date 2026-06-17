import { t } from "@/lib/i18n";
import { relativeLabel, type PortalStageStatus } from "@/lib/portal/progress-map";
import type { PortalProgress } from "@/lib/portal/progress";

const DOT: Record<PortalStageStatus, string> = {
  completed: "bg-teal-600",
  current: "bg-navy-900 ring-2 ring-navy-300",
  pending: "bg-slate-300",
};
const TEXT: Record<PortalStageStatus, string> = {
  completed: "text-navy-800",
  current: "font-semibold text-navy-900",
  pending: "text-slate-400",
};

/** Customer-facing shipment progress (Phase 2.4). Read-only, no internal data. */
export function PortalProgressView({ progress }: { progress: PortalProgress }) {
  const P = t.portal.progress;
  const stageLabel = (k: string) => (P.stages as Record<string, string>)[k] ?? k;
  const tl = progress.timeline;
  const currentLabel = tl.currentKey ? stageLabel(tl.currentKey) : P.done;
  const nextLabel = tl.nextKey ? stageLabel(tl.nextKey) : null;

  return (
    <div className="space-y-4">
      {/* Progress summary card */}
      <div className="surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">{P.currentStatus}</p>
            <p className="text-xl font-bold text-navy-900">{currentLabel}</p>
          </div>
          <span className="text-sm font-medium text-slate-500">
            {tl.percent}% {P.percent}
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${tl.percent}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span>{P.lastUpdate} : <span className="text-navy-800">{relativeLabel(progress.lastUpdate, new Date())}</span></span>
          {nextLabel && <span>{P.nextStep} : <span className="text-navy-800">{nextLabel}</span></span>}
          {progress.podAvailable && <span className="text-teal-700">{P.podAvailable}</span>}
        </div>
      </div>

      {/* Timeline */}
      <div className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">{P.title}</h2>
        <ol className="space-y-3">
          {tl.stages.map((s) => (
            <li key={s.key} className="flex items-center gap-3">
              <span className={`h-3 w-3 shrink-0 rounded-full ${DOT[s.status]}`} aria-hidden />
              <span className={`text-sm ${TEXT[s.status]}`}>{stageLabel(s.key)}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Activity feed (completed milestones) */}
      {progress.activity.length > 0 && (
        <div className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{P.activityTitle}</h2>
          <ul className="space-y-2">
            {progress.activity.map((k) => (
              <li key={k} className="flex items-center gap-2 text-sm text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-600" aria-hidden />
                {stageLabel(k)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

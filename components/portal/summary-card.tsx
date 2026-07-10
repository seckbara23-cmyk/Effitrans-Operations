import { t } from "@/lib/i18n";
import { relativeLabel } from "@/lib/portal/progress-map";
import { formatShortDate } from "@/lib/portal/shipment-view";
import { ProgressTracker } from "./progress-tracker";
import { DelayBadge } from "./delay-badge";
import type { PortalTracking } from "@/lib/portal/tracking";

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent ? "text-teal-700" : "text-navy-900"}`}>{value}</p>
    </div>
  );
}

/** Shipment summary hero — the first thing the customer sees (Phase 3.3A D4). */
export function SummaryCard({ tracking }: { tracking: PortalTracking }) {
  const S = t.portal.premium.summary;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="bg-gradient-to-br from-navy-900 via-navy-800 to-teal-800 px-5 py-5 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] text-teal-200">{S.title}</p>
            <h1 className="tabular mt-0.5 text-2xl font-bold">{tracking.fileNumber}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-teal-100">
              <span aria-hidden>📍</span> {tracking.route.display}
            </p>
          </div>
          <div className="text-right">
            <DelayBadge state={tracking.delay.state} label={tracking.delay.label} />
            <p className="mt-2 tabular text-3xl font-bold">{tracking.progressPercent}%</p>
            <p className="text-[11px] text-teal-200">{S.progress}</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <ProgressTracker timeline={tracking.timeline} />

        {tracking.delay.explanation && (
          <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{tracking.delay.explanation}</p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label={S.location} value={tracking.currentLocation} />
          <Stat label={S.department} value={tracking.currentDepartment} />
          <Stat label={S.officer} value={tracking.officer.name} />
          <Stat label={S.eta} value={tracking.eta.estimatedDate ? formatShortDate(tracking.eta.estimatedDate) : t.portal.premium.eta.none} accent />
          <Stat label={S.lastUpdate} value={relativeLabel(tracking.lastActivityAt, new Date())} />
        </div>
      </div>
    </section>
  );
}

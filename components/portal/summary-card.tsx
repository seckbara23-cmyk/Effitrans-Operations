import { t } from "@/lib/i18n";
import { relativeLabel } from "@/lib/portal/progress-map";
import { formatShortDate, stageToMapPhase } from "@/lib/portal/shipment-view";
import { ProgressTracker } from "./progress-tracker";
import { RiskBadge } from "./risk-badge";
import type { PortalProgress } from "@/lib/portal/progress";
import type { PortalFileSummary } from "@/lib/portal/types";

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent ? "text-teal-700" : "text-navy-900"}`}>{value}</p>
    </div>
  );
}

/**
 * Shipment summary hero — the first thing the customer sees (Phase 3.3 D4).
 * Consumes the existing progress (timeline/risk/eta) + officer; no new logic.
 */
export function SummaryCard({
  file,
  progress,
  officerName,
}: {
  file: PortalFileSummary;
  progress: PortalProgress;
  officerName: string | null;
}) {
  const S = t.portal.premium.summary;
  const mp = t.portal.premium.map;
  const phase = stageToMapPhase(progress.timeline.currentKey);
  const location = (mp as Record<string, string>)[phase] ?? "—";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="bg-gradient-to-br from-navy-900 via-navy-800 to-teal-800 px-5 py-5 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-teal-200">{S.title}</p>
            <h1 className="tabular mt-0.5 text-2xl font-bold">{file.fileNumber}</h1>
            <p className="mt-1 text-sm text-teal-100">
              {file.origin ?? "—"} <span className="text-teal-300">→</span> {file.destination ?? "—"}
            </p>
          </div>
          <div className="text-right">
            <RiskBadge risk={progress.risk} />
            <p className="mt-2 tabular text-3xl font-bold">{progress.timeline.percent}%</p>
            <p className="text-[11px] text-teal-200">{S.progress}</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <ProgressTracker timeline={progress.timeline} />
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label={S.location} value={location} />
          <Stat label={S.department} value={progress.currentDepartment ?? "—"} />
          <Stat label={S.officer} value={officerName ?? t.portal.premium.card.noOfficer} />
          <Stat label={S.eta} value={progress.eta.estimated ? formatShortDate(progress.eta.estimated) : t.portal.premium.eta.none} accent />
          <Stat label={S.lastUpdate} value={relativeLabel(progress.lastUpdate, new Date())} />
        </div>
      </div>
    </section>
  );
}

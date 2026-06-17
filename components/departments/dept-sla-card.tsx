import { t } from "@/lib/i18n";
import type { SlaCounts } from "@/lib/sla/aggregate";

/** Department workspace SLA summary (Phase 2.3 D7). Within / warning / critical. */
export function DeptSlaCard({ counts }: { counts: SlaCounts }) {
  return (
    <div className="surface flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.sla.monitoring}</span>
      <span className="text-sm text-emerald-700">
        {t.sla.withinSla} : <span className="tabular font-bold">{counts.normal}</span>
      </span>
      <span className="text-sm text-amber-700">
        {t.sla.warning} : <span className="tabular font-bold">{counts.warning}</span>
      </span>
      <span className="text-sm text-red-700">
        {t.sla.critical} : <span className="tabular font-bold">{counts.critical}</span>
      </span>
    </div>
  );
}

import { t } from "@/lib/i18n";
import type { DossierSla } from "@/lib/sla/service";
import type { SlaStatus } from "@/lib/sla/classify";

const BADGE: Record<SlaStatus, string> = {
  normal: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
  informational: "bg-slate-100 text-slate-500",
};
const DOT: Record<SlaStatus, string> = { normal: "🟢", warning: "🟡", critical: "🔴", informational: "⚪" };

function hoursLabel(h: number): string {
  if (h >= 48) return `${Math.floor(h / 24)} ${t.sla.days}`;
  return `${Math.round(h)} ${t.sla.hours}`;
}

/** Read-only dossier SLA panel (Phase 2.3 D4). Below the lifecycle tracker. */
export function SlaPanel({ sla, department }: { sla: DossierSla; department: string | null }) {
  const P = t.sla.panel;
  const deptLabel = department ? (t.lifecycle.departments as Record<string, string>)[department] ?? department : "—";
  const stageLabel = sla.stage.currentStage ? (t.lifecycle.steps as Record<string, string>)[sla.stage.currentStage] ?? sla.stage.currentStage : "—";

  return (
    <div className="surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-navy-900">{P.title}</h2>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${BADGE[sla.status]}`}>
          <span aria-hidden>{DOT[sla.status]}</span>
          {(t.sla.status as Record<string, string>)[sla.status]}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
        <p className="text-slate-600">{P.department} : <span className="font-medium text-navy-900">{deptLabel}</span></p>
        <p className="text-slate-600">{P.stage} : <span className="font-medium text-navy-900">{stageLabel}</span></p>
        <p className="text-slate-600">{P.timeInStage} : <span className="tabular font-medium text-navy-900">{sla.stage.ageDays} {t.sla.days}</span></p>
        {sla.threshold ? (
          <p className="text-slate-600">
            {P.warningThreshold} : <span className="tabular font-medium text-amber-700">{hoursLabel(sla.threshold.warningHours)}</span>
            <span className="mx-1 text-slate-300">·</span>
            {P.criticalThreshold} : <span className="tabular font-medium text-red-700">{hoursLabel(sla.threshold.criticalHours)}</span>
          </p>
        ) : (
          <p className="text-slate-400">{P.noSla}</p>
        )}
      </div>
    </div>
  );
}

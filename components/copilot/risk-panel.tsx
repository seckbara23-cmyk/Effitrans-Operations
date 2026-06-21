import { t } from "@/lib/i18n";
import type { RiskAssessment, RiskLevel } from "@/lib/copilot/risk-engine";

/**
 * Dossier Risk Assessment card (Phase 3.1B). Server-safe, read-only.
 * Renders the Risk Engine output directly below the Lifecycle Tracker — no
 * manual editing, no persistence. All values derive from `assessRisk`.
 */
const STYLE: Record<RiskLevel, { badge: string; bar: string; dot: string }> = {
  low: { badge: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500", dot: "🟢" },
  medium: { badge: "bg-amber-50 text-amber-700", bar: "bg-amber-500", dot: "🟡" },
  high: { badge: "bg-orange-50 text-orange-700", bar: "bg-orange-500", dot: "🟠" },
  critical: { badge: "bg-red-50 text-red-700", bar: "bg-red-500", dot: "🔴" },
};

export function RiskPanel({ risk }: { risk: RiskAssessment }) {
  const R = t.risk;
  const s = STYLE[risk.level];
  const levelLabel = R.levels[risk.level];

  return (
    <div className="surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{R.panelTitle}</h2>
          <p className="text-xs text-slate-500">{R.subtitle}</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${s.badge}`}>
          <span aria-hidden>{s.dot}</span>
          {R.level} : {levelLabel}
        </span>
      </div>

      {/* Score bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{R.score}</span>
          <span className="tabular font-medium text-navy-900">{risk.score}/100</span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${risk.score}%` }} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{R.reasons}</p>
          {risk.level === "low" ? (
            <p className="mt-1 text-sm text-slate-500">{R.none}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm text-slate-700">
              {risk.reasons.map((reason, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="text-slate-400">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {risk.actions.length > 0 && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{R.actions}</p>
            <ul className="mt-1 space-y-1 text-sm text-slate-700">
              {risk.actions.map((action, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="text-teal-600">→</span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

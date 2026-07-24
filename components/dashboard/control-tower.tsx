import Link from "next/link";
import { t } from "@/lib/i18n";
import type { ControlTowerData } from "@/lib/control-tower/service";
import { FUNNEL_ORDER, FLOW_ORDER } from "@/lib/control-tower/aggregate";
import type { SlaStatus } from "@/lib/sla/classify";
import type { DeptKey } from "@/lib/sla/aggregate";

const SLA_BADGE: Record<SlaStatus, string> = {
  normal: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
  informational: "bg-slate-100 text-slate-500",
};
const SLA_DOT: Record<SlaStatus, string> = { normal: "🟢", warning: "🟡", critical: "🔴", informational: "⚪" };

const fmtMoney = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;
const dash = "—";

const RISK_BADGE: Record<string, string> = {
  low: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};
const RISK_DOT: Record<string, string> = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" };

function KpiCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-sand-50/40 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 tabular text-xl font-bold text-navy-900">{value}</p>
    </div>
  );
}

export function ControlTower({
  data,
  showExecutiveKpis = true,
}: {
  data: ControlTowerData;
  /**
   * Phase 10.0D-4 — the older six-KPI executive band. Suppressed on /dashboard
   * (the authoritative ExecutiveKpiStrip is the one visible executive band there;
   * no reader/formula change). Defaults true so every other consumer is unchanged.
   */
  showExecutiveKpis?: boolean;
}) {
  const C = t.controlTower;
  const k = data.kpis;
  const deptLabel = (d: string) => (t.lifecycle.departments as Record<string, string>)[d] ?? d;
  const totalAttention = data.needsAttention.length;

  return (
    <div className="space-y-6">
      {/* Executive KPIs — suppressed on /dashboard to avoid two competing KPI bands. */}
      {showExecutiveKpis && (
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{C.kpis.title}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCell label={C.kpis.active} value={k.activeDossiers} />
            <KpiCell label={C.kpis.delivered} value={k.deliveredThisMonth} />
            <KpiCell label={C.kpis.revenue} value={k.revenueThisMonth != null ? fmtMoney(k.revenueThisMonth, k.currency) : dash} />
            <KpiCell label={C.kpis.outstanding} value={k.outstanding != null ? fmtMoney(k.outstanding, k.currency) : dash} />
            <KpiCell label={C.kpis.avgCustoms} value={k.avgCustomsDays != null ? `${k.avgCustomsDays} ${C.kpis.days}` : dash} />
            <KpiCell label={C.kpis.avgDelivery} value={k.avgDeliveryDays != null ? `${k.avgDeliveryDays} ${C.kpis.days}` : dash} />
          </div>
        </section>
      )}

      {/* Risk KPIs (Phase 3.1B) — derived, no stored values */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">{t.risk.kpis.title}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCell label={t.risk.kpis.critical} value={data.riskKpis.critical} />
          <KpiCell label={t.risk.kpis.high} value={data.riskKpis.high} />
          <KpiCell label={t.risk.kpis.slaBreaches} value={data.riskKpis.slaBreaches} />
          <KpiCell label={t.risk.kpis.overdueFinance} value={data.riskKpis.overdueFinance ?? dash} />
        </div>
      </section>

      {/* Needs immediate attention (Phase 3.1B) — risk-ranked, max 10 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">
          {t.risk.attention.title}
          {data.attentionQueue.length > 0 && (
            <span className="ml-2 text-xs font-normal text-slate-400">({data.attentionQueue.length})</span>
          )}
        </h2>
        {data.attentionQueue.length === 0 ? (
          <div className="surface p-6 text-sm text-slate-500">{t.risk.attention.empty}</div>
        ) : (
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{t.risk.attention.dossier}</th>
                    <th className="px-4 py-3 font-semibold">{t.risk.attention.client}</th>
                    <th className="px-4 py-3 font-semibold">{t.risk.attention.level}</th>
                    <th className="px-4 py-3 font-semibold">{t.risk.attention.reason}</th>
                    <th className="px-4 py-3 font-semibold">{t.risk.attention.age}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.attentionQueue.map((it) => (
                    <tr key={it.fileId} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <Link href={`/files/${it.fileId}`} className="tabular font-medium text-teal-700 hover:underline">
                          {it.fileNumber ?? dash}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{it.clientName ?? dash}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${RISK_BADGE[it.level]}`}>
                          <span aria-hidden>{RISK_DOT[it.level]}</span>
                          {(t.risk.levels as Record<string, string>)[it.level]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{it.primaryReason}</td>
                      <td className="px-4 py-3 tabular text-slate-600">{it.ageDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Operational funnel */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">{C.funnel.title}</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
          {FUNNEL_ORDER.map((stage, i) => (
            <div key={stage} className="flex items-center gap-2">
              <div className="min-w-[84px] rounded-lg border border-slate-100 bg-sand-50/40 px-3 py-2 text-center">
                <p className="tabular text-2xl font-bold leading-none text-navy-900">{data.funnel[stage]}</p>
                <p className="mt-1 text-[11px] text-slate-500">{(C.funnel as Record<string, string>)[stage]}</p>
              </div>
              {i < FUNNEL_ORDER.length - 1 && <span className="hidden text-slate-300 sm:inline">›</span>}
            </div>
          ))}
        </div>
      </section>

      {/* Operations flow */}
      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">{C.flow.title}</h2>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
          {FLOW_ORDER.map((node, i) => (
            <div key={node} className="flex items-center gap-2 sm:flex-1">
              <Link
                href={node === "archive" ? "/files" : `/departments/${node === "documentation" ? "documentation" : node}`}
                className="surface flex w-full items-center justify-between gap-3 border border-slate-100 px-3 py-2 transition-shadow hover:shadow-card-hover sm:flex-col sm:text-center"
              >
                <span className="text-xs font-medium text-slate-600">{deptLabel(node)}</span>
                <span className="tabular text-xl font-bold text-navy-900">{data.flow[node]}</span>
              </Link>
              {i < FLOW_ORDER.length - 1 && <span className="text-slate-300">↓</span>}
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Aging */}
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{C.aging.title}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCell label={C.aging.b0_2} value={data.aging.b0_2} />
            <KpiCell label={C.aging.b3_5} value={data.aging.b3_5} />
            <KpiCell label={C.aging.b6_10} value={data.aging.b6_10} />
            <KpiCell label={C.aging.b10p} value={data.aging.b10p} />
          </div>
        </section>

        {/* Bottlenecks */}
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{C.bottlenecks.title}</h2>
          {data.bottlenecks.length === 0 ? (
            <p className="text-sm text-slate-500">{C.bottlenecks.empty}</p>
          ) : (
            <ul className="space-y-2">
              {data.bottlenecks.map((b) => (
                <li key={b.key} className="flex items-center justify-between rounded-lg bg-red-50/60 px-3 py-2 text-sm">
                  <span className="text-red-700">{b.label}</span>
                  <span className="tabular font-bold text-red-700">{b.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Needs attention */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">
          {C.attention.title}
          {totalAttention > 0 && <span className="ml-2 text-xs font-normal text-slate-400">({totalAttention})</span>}
        </h2>
        {data.needsAttention.length === 0 ? (
          <div className="surface p-6 text-sm text-slate-500">{C.attention.empty}</div>
        ) : (
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{C.attention.dossier}</th>
                    <th className="px-4 py-3 font-semibold">{C.attention.client}</th>
                    <th className="px-4 py-3 font-semibold">{C.attention.department}</th>
                    <th className="px-4 py-3 font-semibold">{C.attention.reason}</th>
                    <th className="px-4 py-3 font-semibold">{C.attention.days}</th>
                    <th className="px-4 py-3 font-semibold">{C.attention.nextAction}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.needsAttention.map((it) => (
                    <tr key={it.fileId} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <Link href={`/files/${it.fileId}`} className="tabular font-medium text-teal-700 hover:underline">
                          {it.fileNumber ?? dash}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{it.clientName ?? dash}</td>
                      <td className="px-4 py-3 text-slate-600">{it.department ? deptLabel(it.department) : dash}</td>
                      <td className="px-4 py-3 text-slate-600">{it.reason}</td>
                      <td className="px-4 py-3 tabular text-slate-600">{it.daysWaiting}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{it.nextAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* SLA monitoring (Phase 2.3) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">{t.sla.monitoring}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(["documentation", "customs", "transport", "finance"] as DeptKey[])
            .filter((d) => d !== "finance" || data.canFinance)
            .map((d) => {
              const c = data.slaByDept[d];
              return (
                <div key={d} className="surface p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {(t.lifecycle.departments as Record<string, string>)[d]}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-emerald-700">{t.sla.withinSla}</span>
                    <span className="tabular font-bold text-emerald-700">{c.normal}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-amber-700">{t.sla.warning}</span>
                    <span className="tabular font-bold text-amber-700">{c.warning}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-red-700">{t.sla.critical}</span>
                    <span className="tabular font-bold text-red-700">{c.critical}</span>
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Average durations (Phase 2.3 D8) */}
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{t.sla.avgTitle}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCell label={t.sla.avg.documentation} value={data.avgTimes.documentationDays ?? "N/A"} />
            <KpiCell label={t.sla.avg.customs} value={data.avgTimes.customsDays ?? "N/A"} />
            <KpiCell label={t.sla.avg.transport} value={data.avgTimes.transportDays ?? "N/A"} />
            <KpiCell label={t.sla.avg.toInvoice} value={data.canFinance ? data.avgTimes.timeToInvoiceDays ?? "N/A" : "—"} />
            <KpiCell label={t.sla.avg.toPayment} value={data.canFinance ? data.avgTimes.timeToPaymentDays ?? "N/A" : "—"} />
          </div>
        </section>

        {/* SLA bottleneck ranking (Phase 2.3 D9) */}
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{t.sla.ranking.title}</h2>
          {data.slaRanking.length === 0 ? (
            <p className="text-sm text-slate-500">{t.controlTower.bottlenecks.empty}</p>
          ) : (
            <ul className="space-y-2">
              {data.slaRanking.map((b) => (
                <li key={b.department} className="flex items-center justify-between rounded-lg bg-sand-50/60 px-3 py-2 text-sm">
                  <span className="font-medium text-navy-800">{(t.lifecycle.departments as Record<string, string>)[b.department]}</span>
                  <span className="text-xs">
                    {b.critical > 0 && <span className="mr-2 font-bold text-red-700">{b.critical} {t.sla.ranking.critical}</span>}
                    {b.warning > 0 && <span className="font-bold text-amber-700">{b.warning} {t.sla.ranking.warning}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Delayed dossiers queue (Phase 2.3 D6) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">{t.sla.delayed.title}</h2>
        {data.delayed.length === 0 ? (
          <div className="surface p-6 text-sm text-slate-500">{t.sla.delayed.empty}</div>
        ) : (
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{C.attention.dossier}</th>
                    <th className="px-4 py-3 font-semibold">{C.attention.client}</th>
                    <th className="px-4 py-3 font-semibold">{C.attention.department}</th>
                    <th className="px-4 py-3 font-semibold">{t.sla.delayed.timeInStage}</th>
                    <th className="px-4 py-3 font-semibold">{t.sla.delayed.status}</th>
                    <th className="px-4 py-3 font-semibold">{C.attention.nextAction}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.delayed.map((r) => (
                    <tr key={r.fileId} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <Link href={`/files/${r.fileId}`} className="tabular font-medium text-teal-700 hover:underline">
                          {r.fileNumber ?? dash}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.clientName ?? dash}</td>
                      <td className="px-4 py-3 text-slate-600">{r.department ? (t.lifecycle.departments as Record<string, string>)[r.department] : dash}</td>
                      <td className="px-4 py-3 tabular text-slate-600">{r.daysWaiting} {t.sla.days}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${SLA_BADGE[r.sla]}`}>
                          <span aria-hidden>{SLA_DOT[r.sla]}</span>
                          {(t.sla.status as Record<string, string>)[r.sla]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{r.nextAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

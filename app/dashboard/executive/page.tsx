import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBusinessIntelligence } from "@/lib/bi/service";
import { getControlTower } from "@/lib/control-tower/service";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Tableau exécutif" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}
const fmt = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;

export default async function ExecutiveDashboardPage() {
  const header = <PageHeader meta="Direction" title={t.bi.executive.title} subtitle="Vue exécutive — revenu, opérations, SLA, exposition, clients." />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "analytics:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.bi.forbidden}</Notice></div>;
  }

  const [bi, ct] = await Promise.all([getBusinessIntelligence(permissions), getControlTower(permissions)]);
  const E = t.bi.executive;
  const c = bi.currency;
  const dash = "—";
  const deptLabel = (d: string) => (t.lifecycle.departments as Record<string, string>)[d] ?? d;

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      {/* Revenue */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">{E.revenue}</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
          <StatCard label={E.revenueMonth} value={bi.canFinance ? fmt(bi.revenue.thisMonth, c) : dash} tone="teal" />
          <StatCard label={E.revenueYtd} value={bi.canFinance ? fmt(bi.revenue.ytd, c) : dash} tone="navy" />
          <StatCard label={E.outstanding} value={bi.canFinance ? fmt(bi.revenue.outstanding, c) : dash} tone="amber" />
          <StatCard label={E.collected} value={bi.canFinance ? fmt(bi.revenue.collectedThisMonth, c) : dash} tone="teal" />
          <StatCard label={E.activeClients} value={bi.activeClients} tone="navy" />
          <StatCard label={E.avgInvoice} value={bi.canFinance ? fmt(bi.revenue.avgInvoiceValue, c) : dash} tone="slate" />
        </div>
      </section>

      {/* Operations + financial exposure */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{E.operations}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Cell label={E.activeDossiers} value={ct.kpis.activeDossiers} />
            <Cell label={E.delivered} value={ct.kpis.deliveredThisMonth} />
            <Cell label="Bloquées" value={ct.needsAttention.length} />
          </div>
        </section>
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{E.exposure}</h2>
          {bi.canFinance ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Cell label={t.bi.aging.b0_30} value={fmt(bi.aging.b0_30, c)} />
              <Cell label={t.bi.aging.b31_60} value={fmt(bi.aging.b31_60, c)} />
              <Cell label={t.bi.aging.b61_90} value={fmt(bi.aging.b61_90, c)} />
              <Cell label={t.bi.aging.b90p} value={fmt(bi.aging.b90p, c)} />
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t.bi.notEnough}</p>
          )}
        </section>
      </div>

      {/* SLA + bottlenecks */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{E.sla}</h2>
          <div className="space-y-1.5 text-sm">
            {(["documentation", "customs", "transport", "finance"] as const).map((d) => {
              const s = ct.slaByDept[d];
              return (
                <div key={d} className="flex items-center justify-between">
                  <span className="text-slate-600">{deptLabel(d)}</span>
                  <span className="text-xs">
                    <span className="text-emerald-700">{s.normal}</span> · <span className="text-amber-700">{s.warning}</span> ·{" "}
                    <span className="text-red-700">{s.critical}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">{E.bottlenecks}</h2>
          {ct.bottlenecks.length === 0 ? (
            <p className="text-sm text-slate-500">{t.controlTower.bottlenecks.empty}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {ct.bottlenecks.map((b) => (
                <li key={b.key} className="flex items-center justify-between">
                  <span className="text-slate-600">{b.label}</span>
                  <span className="tabular font-bold text-red-700">{b.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Top clients */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">{E.topClients}</h2>
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{E.client}</th>
                  <th className="px-4 py-3 font-semibold">{E.clientRevenue}</th>
                  <th className="px-4 py-3 font-semibold">Exp.</th>
                  <th className="px-4 py-3 font-semibold">{E.clientOutstanding}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bi.clients.slice(0, 5).map((cl) => (
                  <tr key={cl.clientId}>
                    <td className="px-4 py-3 text-navy-900">{cl.clientName ?? dash}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{bi.canFinance ? fmt(cl.revenue, c) : dash}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{cl.shipments}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{bi.canFinance ? fmt(cl.outstanding, c) : dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <p className="text-xs text-slate-400">
        <Link href="/reports" className="text-teal-700 hover:underline">Centre de rapports →</Link>
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-sand-50/40 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 tabular text-lg font-bold text-navy-900">{value}</p>
    </div>
  );
}

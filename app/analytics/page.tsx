import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAnalytics } from "@/lib/analytics/service";
import { getExecutiveAnalytics } from "@/lib/analytics/executive-service";
import { BarList } from "@/components/analytics/bar-list";
import { HealthBanner } from "@/components/analytics/health-banner";
import { AlertsPanel } from "@/components/analytics/alerts-panel";
import { ExecutiveScorecard } from "@/components/analytics/scorecard";
import { TrendBars } from "@/components/analytics/trend-bars";
import { CollectionsChart } from "@/components/analytics/collections-chart";
import { Pipeline } from "@/components/analytics/pipeline";
import { t } from "@/lib/i18n";
import type { Bar } from "@/lib/analytics/types";

export const metadata: Metadata = { title: t.analytics.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("fr-FR")} %`);
const daysFmt = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("fr-FR")} j`);

function Card({ label, value, accent = "text-navy-900" }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-bold tabular ${accent}`}>{value}</p>
    </div>
  );
}

function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
    </section>
  );
}

export default async function AnalyticsPage() {
  const header = <PageHeader meta="Administration" title={t.analytics.title} subtitle={t.analytics.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.analytics.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "analytics:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.analytics.forbidden}</Notice></div>;
  }

  const canFinance = hasPermission(permissions, "finance:read");
  const a = await getAnalytics(canFinance);
  const exec = await getExecutiveAnalytics(a);
  const A = t.analytics;
  const E = A.exec;
  const fmt = (n: number) => `${n.toLocaleString("fr-FR")} ${a.currency}`;
  const mapLabels = (items: Bar[], dict: Record<string, string>) =>
    items.map((it) => ({ label: dict[it.label] ?? it.label, value: it.value }));

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      {/* 1. Executive health banner */}
      <HealthBanner banner={exec.banner} health={exec.health} lastUpdated={exec.lastUpdated} currency={a.currency} />

      {/* 2. Alerts */}
      <AlertsPanel alerts={exec.alerts} />

      {/* 3. Scorecard */}
      <ExecutiveScorecard scorecard={exec.scorecard} />

      {/* 4–6. Trends */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {exec.revenue12 && <TrendBars title={E.revenue12} points={exec.revenue12} format={fmt} accent="bg-teal-500" />}
        <TrendBars title={E.newDossiers12} points={exec.newDossiers12} accent="bg-navy-500" />
        {exec.collections12 && <CollectionsChart title={E.collections12} points={exec.collections12} currency={a.currency} />}
      </div>

      {/* 7–8. Top clients + routes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {exec.topClients && (
          <section className="surface overflow-x-auto">
            <p className="px-4 pt-3 text-sm font-semibold text-navy-900">{E.topClients.title}</p>
            <table className="mt-2 w-full text-left text-sm">
              <thead className="border-y border-slate-100 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">{E.topClients.client}</th>
                  <th className="px-4 py-2 text-right font-semibold">{E.topClients.revenue}</th>
                  <th className="px-4 py-2 text-right font-semibold">{E.topClients.dossiers}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {exec.topClients.map((c, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-navy-900">{c.clientName}</td>
                    <td className="px-4 py-2 text-right tabular text-slate-700">{fmt(c.revenue)}</td>
                    <td className="px-4 py-2 text-right tabular text-slate-600">{c.dossiers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <section className="surface overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-semibold text-navy-900">{E.routes.title}</p>
          {exec.routes.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-400">{E.routes.empty}</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead className="border-y border-slate-100 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">{E.routes.route}</th>
                  <th className="px-4 py-2 text-right font-semibold">{E.routes.dossiers}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {exec.routes.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-navy-900">{r.route}</td>
                    <td className="px-4 py-2 text-right tabular text-slate-600">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* 9–10. Pipelines */}
      <div className="grid grid-cols-1 gap-4">
        <Pipeline title={E.pipelineCustoms} stages={a.charts.customsPipeline} labels={A.customsPipeline} accent="text-amber-700" />
        <Pipeline title={E.pipelineTransport} stages={a.charts.transportPipeline} labels={A.transportPipeline} accent="text-sky-700" />
      </div>

      {/* 11. Existing KPI sections (calculations intact) */}
      <div className="border-t border-slate-200 pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{E.detailedTitle}</p>
        <div className="space-y-6">
          {a.financial && (
            <Band title={A.bands.financial}>
              <Card label={A.financial.revenueThisMonth} value={fmt(a.financial.revenueThisMonth)} accent="text-teal-700" />
              <Card label={A.financial.revenueYtd} value={fmt(a.financial.revenueYtd)} accent="text-teal-700" />
              <Card label={A.financial.outstanding} value={fmt(a.financial.outstanding)} />
              <Card label={A.financial.overdue} value={fmt(a.financial.overdue)} accent="text-red-700" />
              <Card label={A.financial.invoicesIssuedThisMonth} value={a.financial.invoicesIssuedThisMonth} />
              <Card label={A.financial.collectionRate} value={`${a.financial.collectionRate.toLocaleString("fr-FR")} %`} />
            </Band>
          )}
          <Band title={A.bands.operations}>
            <Card label={A.operations.active} value={a.operations.active} accent="text-teal-700" />
            <Card label={A.operations.newThisMonth} value={a.operations.newThisMonth} />
            <Card label={A.operations.delivered} value={a.operations.delivered} />
            <Card label={A.operations.closed} value={a.operations.closed} />
            <Card label={A.operations.highPriority} value={a.operations.highPriority} accent="text-amber-700" />
            <Card label={A.operations.blocked} value={a.operations.blocked} accent="text-red-700" />
          </Band>
          <Band title={A.bands.customs}>
            <Card label={A.customs.pending} value={a.customs.pending} />
            <Card label={A.customs.underReview} value={a.customs.underReview} />
            <Card label={A.customs.inspection} value={a.customs.inspection} />
            <Card label={A.customs.released} value={a.customs.released} accent="text-teal-700" />
            <Card label={A.customs.avgReleaseDays} value={daysFmt(a.customs.avgReleaseDays)} />
          </Band>
          <Band title={A.bands.transport}>
            <Card label={A.transport.planned} value={a.transport.planned} />
            <Card label={A.transport.inTransit} value={a.transport.inTransit} accent="text-amber-700" />
            <Card label={A.transport.delivered} value={a.transport.delivered} />
            <Card label={A.transport.podReceived} value={a.transport.podReceived} accent="text-teal-700" />
            <Card label={A.transport.onTimePct} value={pct(a.transport.onTimePct)} />
          </Band>
          <Band title={A.bands.portal}>
            <Card label={A.portal.users} value={a.portal.users} />
            <Card label={A.portal.activeClients} value={a.portal.activeClients} />
            <Card label={A.portal.sharedDocuments} value={a.portal.sharedDocuments} />
            <Card label={A.portal.downloads} value={a.portal.downloads} />
            <Card label={A.portal.invoiceViews} value={a.portal.invoiceViews} />
          </Band>
          <Band title={A.bands.team}>
            <Card label={A.team.openTasks} value={a.team.openTasks} />
            <Card label={A.team.completedTasks} value={a.team.completedTasks} accent="text-teal-700" />
            <Card label={A.team.customsReleases} value={a.team.customsReleases} />
            <Card label={A.team.invoicesIssued} value={a.team.invoicesIssued} />
            <Card label={A.team.avgClosureDays} value={daysFmt(a.team.avgClosureDays)} />
          </Band>
          <section className="surface space-y-3 p-4">
            <h3 className="text-sm font-semibold text-navy-900">{A.charts.statusDistribution}</h3>
            <BarList items={mapLabels(a.charts.statusDistribution, t.files.statuses as Record<string, string>)} accent="bg-navy-500" />
          </section>
        </div>
      </div>
    </div>
  );
}

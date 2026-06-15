import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAnalytics } from "@/lib/analytics/service";
import { BarList } from "@/components/analytics/bar-list";
import { t } from "@/lib/i18n";
import type { Bar } from "@/lib/analytics/types";

export const metadata: Metadata = { title: t.analytics.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

const money = (currency: string) => (n: number) => `${n.toLocaleString("fr-FR")} ${currency}`;
const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("fr-FR")} %`);
const days = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("fr-FR")} j`);

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

function Chart({ title, items, format, accent }: { title: string; items: Bar[]; format?: (n: number) => string; accent?: string }) {
  return (
    <section className="surface space-y-3 p-4">
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{t.analytics.charts.empty}</p>
      ) : (
        <BarList items={items} format={format} accent={accent} />
      )}
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
  const fmt = money(a.currency);
  const A = t.analytics;

  const mapLabels = (items: Bar[], dict: Record<string, string>) =>
    items.map((it) => ({ label: dict[it.label] ?? it.label, value: it.value }));

  return (
    <div className="animate-fade-in space-y-6">
      {header}

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
        <Card label={A.customs.avgReleaseDays} value={days(a.customs.avgReleaseDays)} />
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
        <Card label={A.team.avgClosureDays} value={days(a.team.avgClosureDays)} />
      </Band>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {a.charts.revenueTrend && (
          <Chart title={A.charts.revenueTrend} items={a.charts.revenueTrend.map((p) => ({ label: p.month, value: p.value }))} format={fmt} />
        )}
        <Chart
          title={A.charts.statusDistribution}
          items={mapLabels(a.charts.statusDistribution, t.files.statuses as Record<string, string>)}
          accent="bg-navy-500"
        />
        {a.charts.revenueByClient && (
          <Chart title={A.charts.revenueByClient} items={a.charts.revenueByClient} format={fmt} accent="bg-teal-500" />
        )}
        <Chart title={A.charts.customsPipeline} items={mapLabels(a.charts.customsPipeline, A.customsPipeline)} accent="bg-amber-500" />
        <Chart title={A.charts.transportPipeline} items={mapLabels(a.charts.transportPipeline, A.transportPipeline)} accent="bg-sky-500" />
      </div>
    </div>
  );
}

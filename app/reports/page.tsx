import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBusinessIntelligence } from "@/lib/bi/service";
import { getControlTower } from "@/lib/control-tower/service";
import { revenueReport, clientsReport, operationsReport, financeReport, slaReport, type ReportTable, type ReportType } from "@/lib/bi/reports";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Centre de rapports" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

function exportHref(type: ReportType, format: "csv" | "xlsx", from?: string, to?: string): string {
  const q = new URLSearchParams({ type, format });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return `/api/reports/export?${q.toString()}`;
}

function ReportSection({ title, type, table, from, to }: { title: string; type: ReportType; table: ReportTable; from?: string; to?: string }) {
  const R = t.bi.reports;
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
        <div className="flex gap-2 text-xs">
          <a href={exportHref(type, "csv", from, to)} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-navy-700 hover:bg-slate-50">{R.csv}</a>
          <a href={exportHref(type, "xlsx", from, to)} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-navy-700 hover:bg-slate-50">{R.xlsx}</a>
        </div>
      </div>
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>{table.headers.map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-2 tabular text-slate-600">{cell == null ? "—" : String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams?: { from?: string; to?: string } }) {
  const R = t.bi.reports;
  const header = <PageHeader meta="Administration" title={R.title} subtitle={R.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "analytics:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.bi.forbidden}</Notice></div>;
  }

  const from = searchParams?.from || undefined;
  const to = searchParams?.to || undefined;
  const [bi, ct] = await Promise.all([getBusinessIntelligence(permissions, { from, to }), getControlTower(permissions)]);

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      {/* Date range filter (applies to revenue / clients / finance / operations) */}
      <form className="surface flex flex-wrap items-end gap-3 p-4" method="get">
        <label className="text-xs text-slate-500">
          {R.from}
          <input type="date" name="from" defaultValue={from} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-500">
          {R.to}
          <input type="date" name="to" defaultValue={to} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800">{R.apply}</button>
      </form>

      <ReportSection title={R.revenue} type="revenue" table={revenueReport(bi)} from={from} to={to} />
      <ReportSection title={R.clients} type="clients" table={clientsReport(bi)} from={from} to={to} />
      <ReportSection title={R.operations} type="operations" table={operationsReport(bi)} from={from} to={to} />
      <ReportSection title={R.sla} type="sla" table={slaReport(ct.slaByDept)} from={from} to={to} />
      <ReportSection title={R.finance} type="finance" table={financeReport(bi)} from={from} to={to} />
    </div>
  );
}

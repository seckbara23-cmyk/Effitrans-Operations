import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getFinanceQueue } from "@/lib/finance/service";
import { INVOICE_STATUSES } from "@/lib/finance/status";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.finance.title };
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  ISSUED: "bg-sky-50 text-sky-700",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700",
  PAID: "bg-teal-50 text-teal-700",
  VOID: "bg-slate-100 text-slate-400",
};

const fmt = (n: number, currency: string) => `${n.toLocaleString("fr-FR")} ${currency}`;

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const header = <PageHeader meta="Administration" title={t.finance.title} subtitle={t.finance.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.finance.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "finance:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.finance.forbidden}</Notice></div>;
  }

  const status = searchParams?.status;
  const rows = await getFinanceQueue(status ? { status } : undefined);

  const pill = (label: string, value: string | undefined) => {
    const active = status === value;
    const href = value ? `/finance?status=${value}` : "/finance";
    return (
      <Link
        key={label}
        href={href}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
          active ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="animate-fade-in space-y-5">
      {header}

      <div className="flex flex-wrap items-center gap-2">
        {pill("Tous", undefined)}
        {INVOICE_STATUSES.map((s) => pill(t.finance.statuses[s], s))}
      </div>

      {rows.length === 0 ? (
        <Notice>{t.finance.empty}</Notice>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t.finance.columns.number}</th>
                <th className="px-4 py-3 font-semibold">{t.finance.columns.file}</th>
                <th className="px-4 py-3 font-semibold">{t.finance.columns.client}</th>
                <th className="px-4 py-3 font-semibold">{t.finance.columns.total}</th>
                <th className="px-4 py-3 font-semibold">{t.finance.columns.balance}</th>
                <th className="px-4 py-3 font-semibold">{t.finance.columns.due}</th>
                <th className="px-4 py-3 font-semibold">{t.finance.columns.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 tabular font-medium text-navy-900">{r.invoiceNumber ?? t.finance.invoices.draft}</td>
                  <td className="px-4 py-3">
                    <Link href={`/files/${r.fileId}`} className="tabular text-teal-700 hover:underline">
                      {r.fileNumber ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.clientName ?? t.common.none}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{fmt(r.total, r.currency)}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{fmt(r.balance, r.currency)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.dueDate ?? "—"}
                    {r.overdue && <span className="ml-1 text-xs font-semibold text-red-600">⚠</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {t.finance.statuses[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

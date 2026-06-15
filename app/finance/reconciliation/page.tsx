import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getReconciliation } from "@/lib/finance/service";
import { ReconciliationActions } from "@/components/finance/reconciliation-actions";
import { t } from "@/lib/i18n";
import type { ReconciliationPayment } from "@/lib/finance/types";

export const metadata: Metadata = { title: t.finance.reconciliation.title };
export const dynamic = "force-dynamic";

const fmt = (n: number, currency: string) => `${n.toLocaleString("fr-FR")} ${currency}`;

const VERIFY_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  VERIFIED: "bg-teal-50 text-teal-700",
  REJECTED: "bg-slate-100 text-slate-400",
};

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

function Stat({ label, value, accent = "text-navy-900" }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-bold tabular ${accent}`}>{value}</p>
    </div>
  );
}

function PaymentTable({
  rows,
  emptyLabel,
  canVerify,
}: {
  rows: ReconciliationPayment[];
  emptyLabel: string;
  canVerify: boolean;
}) {
  const R = t.finance.reconciliation;
  if (rows.length === 0) return <Notice>{emptyLabel}</Notice>;
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">{t.finance.columns.file}</th>
            <th className="px-4 py-3 font-semibold">{t.finance.columns.client}</th>
            <th className="px-4 py-3 font-semibold">{t.finance.invoices.amount}</th>
            <th className="px-4 py-3 font-semibold">{t.finance.invoices.method}</th>
            <th className="px-4 py-3 font-semibold">{t.finance.invoices.reference}</th>
            <th className="px-4 py-3 font-semibold">{t.finance.invoices.due}</th>
            <th className="px-4 py-3 text-right font-semibold">{t.finance.columns.status}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50/60">
              <td className="px-4 py-3">
                <Link href={`/files/${p.fileId}`} className="tabular text-teal-700 hover:underline">
                  {p.fileNumber ?? p.invoiceNumber ?? "—"}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-600">{p.clientName ?? t.common.none}</td>
              <td className="px-4 py-3 tabular text-slate-700">{fmt(p.amount, p.currency)}</td>
              <td className="px-4 py-3 text-slate-600">{t.finance.methods[p.method]}</td>
              <td className="px-4 py-3 text-slate-600">
                {p.reference ?? p.providerReference ?? <span className="text-amber-600">{R.noReference}</span>}
                {p.providerName && <span className="ml-1 text-xs text-slate-400">({p.providerName})</span>}
              </td>
              <td className="px-4 py-3 tabular text-slate-500">{p.paidAt}</td>
              <td className="px-4 py-3">
                {canVerify && p.verificationStatus === "PENDING" ? (
                  <ReconciliationActions paymentId={p.id} />
                ) : (
                  <div className="text-right">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${VERIFY_STYLE[p.verificationStatus]}`}>
                      {t.finance.verification[p.verificationStatus]}
                    </span>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReconciliationPage() {
  const R = t.finance.reconciliation;
  const header = <PageHeader meta="Administration" title={R.title} subtitle={R.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.finance.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "finance:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.finance.forbidden}</Notice></div>;
  }
  const canVerify = hasPermission(permissions, "finance:void");

  const data = await getReconciliation();

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={R.counts.pending} value={data.counts.pending} accent="text-amber-700" />
        <Stat label={R.counts.verified} value={data.counts.verified} accent="text-teal-700" />
        <Stat label={R.counts.rejected} value={data.counts.rejected} accent="text-slate-500" />
        <Stat label={R.counts.missingReference} value={data.counts.missingReference} accent="text-amber-700" />
        <Stat label={R.counts.outstanding} value={fmt(data.outstandingTotal, data.currency)} />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-navy-900">{R.sections.pending}</h2>
        <PaymentTable rows={data.pending} emptyLabel={R.empty.pending} canVerify={canVerify} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-navy-900">{R.sections.missingReference}</h2>
        <PaymentTable rows={data.missingReference} emptyLabel={R.empty.missingReference} canVerify={canVerify} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-navy-900">{R.sections.recentlyResolved}</h2>
        <PaymentTable rows={data.recentlyResolved} emptyLabel={R.empty.recentlyResolved} canVerify={false} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-navy-900">{R.sections.onlineIntents}</h2>
        {data.onlineIntents.length === 0 ? (
          <Notice>{R.empty.onlineIntents}</Notice>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t.finance.columns.file}</th>
                  <th className="px-4 py-3 font-semibold">{t.finance.columns.client}</th>
                  <th className="px-4 py-3 font-semibold">{t.finance.intents.provider}</th>
                  <th className="px-4 py-3 font-semibold">{t.finance.invoices.amount}</th>
                  <th className="px-4 py-3 text-right font-semibold">{t.finance.columns.status}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.onlineIntents.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link href={`/files/${i.fileId}`} className="tabular text-teal-700 hover:underline">
                        {i.fileNumber ?? i.invoiceNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{i.clientName ?? t.common.none}</td>
                    <td className="px-4 py-3 text-slate-600">{t.finance.intents.providers[i.provider]}</td>
                    <td className="px-4 py-3 tabular text-slate-700">{fmt(i.amount, i.currency)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {t.finance.intents.statuses[i.status]}
                      </span>
                      {i.lastError && <span className="ml-1 text-[10px] text-red-500">{i.lastError}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-navy-900">{R.sections.outstanding}</h2>
        {data.outstanding.length === 0 ? (
          <Notice>{R.empty.outstanding}</Notice>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t.finance.columns.number}</th>
                  <th className="px-4 py-3 font-semibold">{t.finance.columns.file}</th>
                  <th className="px-4 py-3 font-semibold">{t.finance.columns.client}</th>
                  <th className="px-4 py-3 font-semibold">{t.finance.columns.balance}</th>
                  <th className="px-4 py-3 font-semibold">{t.finance.columns.due}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.outstanding.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 tabular font-medium text-navy-900">{i.invoiceNumber ?? t.finance.invoices.draft}</td>
                    <td className="px-4 py-3">
                      <Link href={`/files/${i.fileId}`} className="tabular text-teal-700 hover:underline">
                        {i.fileNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{i.clientName ?? t.common.none}</td>
                    <td className="px-4 py-3 tabular text-slate-700">{fmt(i.balance, i.currency)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {i.dueDate ?? "—"}
                      {i.overdue && <span className="ml-1 text-xs font-semibold text-red-600">⚠</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

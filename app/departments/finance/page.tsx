import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getFinanceQueue, getReconciliation } from "@/lib/finance/service";
import { getFinanceMonthRevenue } from "@/lib/departments/service";
import { readyForBillingCount } from "@/lib/handoffs/service";
import { getDepartmentSlaSummary } from "@/lib/sla/service";
import { DeptSlaCard } from "@/components/departments/dept-sla-card";
import { DeptAttentionCard } from "@/components/departments/dept-attention-card";
import { financeCards, financeNextAction } from "@/lib/departments/classify";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

const STATUS = (s: string) => (t.finance.statuses as Record<string, string>)[s] ?? s;
const fmt = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;

export default async function FinanceDepartmentPage() {
  const header = (
    <PageHeader
      meta="Départements"
      title="Finance"
      subtitle="File finance : facturation, encours, retards, revenu du mois et paiements à vérifier."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.finance.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "finance:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.finance.forbidden}</Notice></div>;
  }

  const [queue, recon, revenueMonth, readyForBilling, slaCounts] = await Promise.all([
    getFinanceQueue(),
    getReconciliation(),
    getFinanceMonthRevenue(),
    readyForBillingCount(),
    getDepartmentSlaSummary("finance"),
  ]);
  const cards = financeCards(queue, recon.counts.pending, revenueMonth);
  const currency = queue[0]?.currency ?? recon.currency ?? "XOF";

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <StatCard label={t.handoffs.cards.readyForBilling} value={readyForBilling} tone="navy" />
        <StatCard label="Factures en cours" value={cards.invoicesPending} tone="navy" />
        <StatCard label="Encours" value={fmt(cards.outstanding, currency)} tone="amber" />
        <StatCard label="En retard" value={cards.overdue} tone="red" />
        <StatCard label="Revenu (mois)" value={fmt(cards.revenueMonth, currency)} tone="teal" />
        <StatCard label="Paiements à vérifier" value={cards.paymentsToVerify} tone="amber" href="/finance/reconciliation" />
      </div>
      <DeptSlaCard counts={slaCounts} />
      <DeptAttentionCard
        items={[
          { label: t.risk.dept.overdueInvoices, value: cards.overdue, tone: "red" },
          { label: t.risk.dept.outstanding, value: fmt(cards.outstanding, currency), tone: "amber" },
        ]}
      />

      {queue.length === 0 ? (
        <Notice>{t.finance.empty}</Notice>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">N° facture</th>
                  <th className="px-4 py-3 font-semibold">Dossier</th>
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Solde</th>
                  <th className="px-4 py-3 font-semibold">Échéance</th>
                  <th className="px-4 py-3 font-semibold">Prochaine action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 tabular font-medium text-navy-900">{r.invoiceNumber ?? t.finance.invoices.draft}</td>
                    <td className="px-4 py-3">
                      <Link href={`/files/${r.fileId}`} className="tabular text-teal-700 hover:underline">
                        {r.fileNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.clientName ?? t.common.none}</td>
                    <td className="px-4 py-3 text-slate-600">{STATUS(r.status)}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{fmt(r.total, r.currency)}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{fmt(r.balance, r.currency)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.dueDate ?? "—"}
                      {r.overdue && <span className="ml-1 text-xs font-semibold text-red-600">⚠</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/files/${r.fileId}`} className="text-xs font-medium text-navy-700 hover:text-teal-700">
                        {financeNextAction(r.status).label} →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-400">
        Émettre / encaisser s&apos;effectue dans le dossier (volet Finance) · <Link href="/finance/reconciliation" className="text-teal-700 hover:underline">rapprochement</Link>.
      </p>
    </div>
  );
}

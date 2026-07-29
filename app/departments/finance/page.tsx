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
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { DeptSlaCard } from "@/components/departments/dept-sla-card";
import { DeptAttentionCard } from "@/components/departments/dept-attention-card";
import { financeCards, financeNextAction } from "@/lib/departments/classify";
import { agingWorkspaceEnabled } from "@/lib/finance/aging/rollout";
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

  // WES-3A.6 — the Recouvrement tile must be gated on EXACTLY what /collections
  // requires, or it becomes a link to a 404. See the comment on financeLinks.
  const collectionsAvailable =
    globalKillSwitch().enabled && (await getTenantProcessFlags(user.tenantId)).collections;

  const [queue, recon, revenueMonth, readyForBilling, slaCounts] = await Promise.all([
    getFinanceQueue(),
    getReconciliation(),
    getFinanceMonthRevenue(),
    readyForBillingCount(),
    getDepartmentSlaSummary("finance"),
  ]);
  const cards = financeCards(queue, recon.counts.pending, revenueMonth);
  const currency = queue[0]?.currency ?? recon.currency ?? "XOF";

  // Finance workspaces (module links, not sidebar sections) — each shown only to
  // holders of its permission, over EXISTING routes. "Finance Requests" is the
  // per-dossier finance panel (no standalone route), so it is intentionally omitted
  // rather than fabricated. Caisse preserves the Phase 9.3A integration.
  //
  // WES-3A.6 — `available` exists because a permission gate alone is NOT the
  // same as the target route's gate. /collections additionally requires the
  // global kill switch and the TENANT `collections` rollout flag, and those
  // flags fail closed (a tenant with no rollout row, or with process_engine
  // off, gets collections=false). Gating this tile on `collections:manage`
  // alone therefore rendered a link that 404s — the reported defect.
  //
  // The sidebar (lib/navigation/build.ts) already gated on the flag AND the
  // permission; this list did not. Two gating implementations, drifted — the
  // exact failure mode the navigation builder's own header warns about.
  const agingEnabled = agingWorkspaceEnabled();
  const financeLinks = [
    { label: "Facturation", href: "/finance", permission: "finance:read", desc: "Factures, encours et statuts de règlement." },
    { label: "Recouvrement", href: "/collections", permission: "collections:manage", available: collectionsAvailable, desc: "Balance âgée, relances et promesses." },
    { label: "Autorisations de dépenses", href: "/finance/autorisations-depenses", permission: "finance:expense:read", desc: "Établir, soumettre et imprimer les autorisations de dépenses." },
    { label: "Caisse", href: "/finance/caisse", permission: "caisse:manage", desc: "Opérations de caisse et de trésorerie (espèces, chèques, Mobile Money, banques)." },
    // FIN-AGING-3 — read-only aged balance. `available` is REQUIRED here, not
    // decorative: /finance/aging 404s unless the env kill switch is on, so a
    // permission-only tile would link to a dead page — the same defect WES-3A.6
    // fixed for Recouvrement.
    { label: "Balance âgée", href: "/finance/aging", permission: "finance:aging:read", available: agingEnabled, desc: "Encours clients par tranche d'ancienneté, analyse par client et dossiers critiques." },
    { label: "Rapprochement", href: "/finance/reconciliation", permission: "finance:read", desc: "Vérification des paiements reçus." },
    { label: "Rapports", href: "/reports", permission: "report:read", desc: "Indicateurs financiers et exports." },
  ].filter((l) => hasPermission(permissions, l.permission) && l.available !== false);

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      {/* Finance workspaces — normalized module links (incl. Caisse from Phase 9.3A),
          each permission-gated, over existing routes. Not a sidebar section. */}
      {financeLinks.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {financeLinks.map((l) => (
            <Link key={l.href} href={l.href} className="surface block p-4 transition-colors hover:border-teal-300">
              <p className="text-sm font-semibold text-navy-900">{l.label}</p>
              <p className="mt-1 text-xs text-slate-500">{l.desc}</p>
            </Link>
          ))}
        </div>
      )}

      {/* WES-3A.6 — the capability exists and this user may use it, but it is
          not enabled for their organization. Saying so beats silently removing
          the entry: the previous behaviour was a link to a 404, and a tile that
          simply vanishes leaves the same question unanswered. Enabling the
          rollout flag is an OPERATOR action, never a code change, so this
          points at that rather than pretending to offer a way in. */}
      {!collectionsAvailable && hasPermission(permissions, "collections:manage") && (
        <div className="surface border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-navy-900">Recouvrement</p>
          <p className="mt-1 text-xs text-amber-800">
            Ce module n&apos;est pas activé pour votre organisation. Contactez votre
            administrateur pour l&apos;activer.
          </p>
        </div>
      )}

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

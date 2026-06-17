import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAnalytics } from "@/lib/analytics/service";
import { pendingHandoffsCount } from "@/lib/handoffs/service";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Direction" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

const fmt = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;

export default async function ManagementDepartmentPage() {
  const header = (
    <PageHeader
      meta="Départements"
      title="Direction"
      subtitle="Supervision exécutive (lecture seule) : activité, douane, transport, revenu et blocages."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "analytics:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé à la supervision.</Notice></div>;
  }

  const canFinance = hasPermission(permissions, "finance:read");
  const [a, pendingHandoffs] = await Promise.all([getAnalytics(canFinance), pendingHandoffsCount()]);
  const currency = a.currency;
  const customsInProcess = a.customs.pending + a.customs.underReview + a.customs.inspection;
  const transportInProcess = a.transport.planned + a.transport.inTransit;

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label="Dossiers actifs" value={a.operations.active} tone="navy" href="/files" />
        <StatCard label="Douane en cours" value={customsInProcess} tone="amber" href="/departments/customs" />
        <StatCard label="Transport en cours" value={transportInProcess} tone="amber" href="/departments/transport" />
        <StatCard
          label="Revenu (mois)"
          value={a.financial ? fmt(a.financial.revenueThisMonth, currency) : "—"}
          tone="teal"
        />
        <StatCard
          label="Encours clients"
          value={a.financial ? fmt(a.financial.outstanding, currency) : "—"}
          tone="amber"
          href={canFinance ? "/departments/finance" : undefined}
        />
        <StatCard label="Opérations bloquées" value={a.operations.blocked} tone="red" />
        <StatCard label={t.handoffs.cards.pendingHandoffs} value={pendingHandoffs} tone="amber" />
      </div>

      <div className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Indicateurs complémentaires</h2>
        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-slate-600 sm:grid-cols-3">
          <p>Livrés (transport) : <span className="tabular font-medium text-navy-900">{a.transport.delivered}</span></p>
          <p>Mainlevées douane : <span className="tabular font-medium text-navy-900">{a.customs.released}</span></p>
          <p>Dossiers livrés : <span className="tabular font-medium text-navy-900">{a.operations.delivered}</span></p>
          <p>Priorité haute : <span className="tabular font-medium text-navy-900">{a.operations.highPriority}</span></p>
          <p>Tâches ouvertes : <span className="tabular font-medium text-navy-900">{a.team.openTasks}</span></p>
          {a.financial && (
            <p>En retard : <span className="tabular font-medium text-navy-900">{fmt(a.financial.overdue, currency)}</span></p>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Vue exécutive en lecture seule · <Link href="/analytics" className="text-teal-700 hover:underline">analytique détaillée</Link>.
      </p>
    </div>
  );
}

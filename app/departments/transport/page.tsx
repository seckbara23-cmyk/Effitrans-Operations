import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getTransportQueue } from "@/lib/transport/service";
import { readyForDispatchCount } from "@/lib/handoffs/service";
import { getDepartmentSlaSummary } from "@/lib/sla/service";
import { DeptSlaCard } from "@/components/departments/dept-sla-card";
import { transportCards, transportNextAction } from "@/lib/departments/classify";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Transport" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

const STATUS = (s: string) => (t.transport.statuses as Record<string, string>)[s] ?? s;

export default async function TransportDepartmentPage() {
  const header = (
    <PageHeader
      meta="Départements"
      title="Transport"
      subtitle="File transport : dispatch, affectations, en transit, livraisons et POD."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Configuration requise.</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé au transport.</Notice></div>;
  }

  const [rows, ready, slaCounts] = await Promise.all([
    getTransportQueue(),
    readyForDispatchCount(),
    getDepartmentSlaSummary("transport"),
  ]);
  const cards = transportCards(rows);

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label={t.handoffs.cards.readyForDispatch} value={ready} tone="navy" />
        <StatCard label="Chauffeur affecté" value={cards.assigned} tone="navy" />
        <StatCard label="En transit" value={cards.inTransit} tone="amber" />
        <StatCard label="POD requis" value={cards.podRequired} tone="red" />
        <StatCard label="Livrés (POD reçu)" value={cards.delivered} tone="teal" />
      </div>
      <DeptSlaCard counts={slaCounts} />

      {rows.length === 0 ? (
        <Notice>Aucun dossier transport à traiter.</Notice>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Dossier</th>
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3 font-semibold">Chauffeur</th>
                  <th className="px-4 py-3 font-semibold">Véhicule</th>
                  <th className="px-4 py-3 font-semibold">Livraison prévue</th>
                  <th className="px-4 py-3 font-semibold">Prochaine action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link href={`/files/${r.fileId}`} className="tabular font-medium text-teal-700 hover:underline">
                        {r.fileNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.clientName ?? t.common.none}</td>
                    <td className="px-4 py-3 text-slate-600">{STATUS(r.status)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.driverName ?? t.common.none}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{r.vehiclePlate ?? t.common.none}</td>
                    <td className="px-4 py-3 text-slate-600">{r.deliveryPlanned ?? t.common.none}</td>
                    <td className="px-4 py-3">
                      <Link href={`/files/${r.fileId}`} className="text-xs font-medium text-navy-700 hover:text-teal-700">
                        {transportNextAction(r.status).label} →
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
        Démarrer / affecter / livrer et téléverser le POD s&apos;effectue dans le dossier (volet Transport) · <Link href="/transport" className="text-teal-700 hover:underline">vue transport complète</Link>.
      </p>
    </div>
  );
}

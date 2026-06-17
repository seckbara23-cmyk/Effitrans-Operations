import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getCustomsQueue } from "@/lib/customs/service";
import { readyForDeclarationCount } from "@/lib/handoffs/service";
import { getDepartmentSlaSummary } from "@/lib/sla/service";
import { DeptSlaCard } from "@/components/departments/dept-sla-card";
import { customsCards, customsNextAction } from "@/lib/departments/classify";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Dédouanement" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

const STATUS = (s: string) => (t.customs.statuses as Record<string, string>)[s] ?? s;

export default async function CustomsDepartmentPage() {
  const header = (
    <PageHeader
      meta="Départements"
      title="Dédouanement"
      subtitle="File douane : déclarations à préparer, réponses attendues, inspections et mainlevées."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.customs.notConfigured ?? "Configuration requise."}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "customs:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>Accès non autorisé au dédouanement.</Notice></div>;
  }

  const [rows, ready, slaCounts] = await Promise.all([
    getCustomsQueue(),
    readyForDeclarationCount(),
    getDepartmentSlaSummary("customs"),
  ]);
  const cards = customsCards(rows);

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label={t.handoffs.cards.readyForDeclaration} value={ready} tone="navy" />
        <StatCard label="En attente de réponse" value={cards.awaitingResponse} tone="amber" />
        <StatCard label="Sous inspection" value={cards.underInspection} tone="amber" />
        <StatCard label="Prêt pour mainlevée" value={cards.readyForRelease} tone="teal" />
        <StatCard label="Files douane" value={rows.length} tone="slate" />
      </div>
      <DeptSlaCard counts={slaCounts} />

      {rows.length === 0 ? (
        <Notice>Aucun dossier douane à traiter.</Notice>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Dossier</th>
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Statut douane</th>
                  <th className="px-4 py-3 font-semibold">N° déclaration</th>
                  <th className="px-4 py-3 font-semibold">BAE</th>
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
                    <td className="px-4 py-3 tabular text-slate-600">{r.declarationNumber ?? t.common.none}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{r.baeReference ?? t.common.none}</td>
                    <td className="px-4 py-3">
                      <Link href={`/files/${r.fileId}`} className="text-xs font-medium text-navy-700 hover:text-teal-700">
                        {customsNextAction(r.status).label} →
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
        Créer/déclarer/libérer s&apos;effectue dans le dossier (volet Douane) · <Link href="/customs" className="text-teal-700 hover:underline">vue douane complète</Link>.
      </p>
    </div>
  );
}

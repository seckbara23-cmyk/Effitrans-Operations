/**
 * Performance des collaborateurs.
 *
 * One row per collaborateur, and every column is a fact the platform can
 * source: dossiers, jours travaillés (D3 — calendar minus approved leave, a
 * half-day counting 0,5), ICTD, and the reliability marker.
 *
 * The retired mechanism does not appear here and cannot: `reliabilityStatus`
 * takes volume and incident only, so there is no coverage figure to render and
 * no « Non classé » to render it as.
 */
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { monthPeriod, collaboratorPerformance } from "@/lib/performance/read";
import { MIN_DOSSIERS, type ReliabilityStatus } from "@/lib/performance/reliability";

export const metadata: Metadata = { title: "Performance des collaborateurs" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ReliabilityStatus, string> = {
  AUCUNE_DONNEE: "Aucune donnée",
  PROVISOIRE: "Provisoire",
  REVUE_MANAGERIALE: "Revue managériale",
  CLASSE: "Classé",
};
const STATUS_STYLE: Record<ReliabilityStatus, string> = {
  AUCUNE_DONNEE: "bg-slate-100 text-slate-600",
  PROVISOIRE: "bg-amber-50 text-amber-700",
  REVUE_MANAGERIALE: "bg-red-50 text-red-700",
  CLASSE: "bg-teal-50 text-teal-700",
};

export default async function CollaboratorsPage({
  searchParams,
}: {
  searchParams?: Promise<{ mois?: string }>;
}) {
  const user = await requireUser();
  const sp = (await searchParams) ?? {};
  const period = monthPeriod(sp.mois ?? new Date().toISOString().slice(0, 10));
  const rows = await collaboratorPerformance(user.tenantId, period);

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Gestion de la Performance"
        title="Performance des collaborateurs"
        subtitle={`Période : ${period.label}`}
      />

      {rows.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">
          Aucun dossier douanier saisi sur cette période.
        </div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Collaborateur</th>
                <th className="px-4 py-3 text-right">Dossiers</th>
                <th className="px-4 py-3 text-right">Jours travaillés</th>
                <th className="px-4 py-3 text-right">ICTD (UTD)</th>
                <th className="px-4 py-3 text-right">ICTD / jour</th>
                <th className="px-4 py-3">Fiabilité</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-4 py-3 text-navy-900">{r.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.dossierCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.workedDays.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.ictdTotal !== null ? r.ictdTotal.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.ictdPerDay !== null ? r.ictdPerDay.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        « Provisoire » signale moins de {MIN_DOSSIERS} dossiers sur la période : le volume ne permet
        pas encore d&apos;interpréter le résultat, et le collaborateur n&apos;entre pas dans un
        classement. Les jours travaillés excluent les jours fériés, les fermetures exceptionnelles et
        les congés approuvés ; une demi-journée de congé compte 0,5.
      </p>
    </div>
  );
}

/**
 * ICTD — the per-dossier detail behind the collaborateur totals.
 *
 * Management asked to understand the figures, not merely see them, so this tab
 * shows the dossier-level inputs: the declaration type that drives CDP, the SH
 * positions that drive the bloc, the délai in working days, and the
 * certification state. A row whose ICTD is blank says so — the workbook's own
 * rule is that a dossier without CDP or DPI does not score, and a blank is not
 * a zero.
 */
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { monthPeriod, ictdDossiers } from "@/lib/performance/read";
import { CDP_COEFFICIENTS, DECLARATION_TYPES } from "@/lib/performance/declaration-type";

export const metadata: Metadata = { title: "ICTD" };
export const dynamic = "force-dynamic";

export default async function IctdPage({
  searchParams,
}: {
  searchParams?: Promise<{ mois?: string }>;
}) {
  const user = await requireUser();
  const sp = (await searchParams) ?? {};
  const period = monthPeriod(sp.mois ?? new Date().toISOString().slice(0, 10));
  const rows = await ictdDossiers(user.tenantId, period);

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Gestion de la Performance"
        title="ICTD — Indicateur de Charge de Travail Déclarant"
        subtitle={`Période : ${period.label}`}
      />

      <div className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Coefficients en vigueur (CDP)</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {DECLARATION_TYPES.map((t) => (
            <span key={t} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
              {t} — {CDP_COEFFICIENTS[t].toFixed(2).replace(".", ",")}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Quatre types de déclaration. « DPE » n&apos;est pas un type : c&apos;était une écriture
          historique de DEP dans le classeur, normalisée à l&apos;import et impossible à saisir en
          production.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">
          Aucun dossier douanier saisi sur cette période.
        </div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Dossier</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Positions SH</th>
                <th className="px-4 py-3 text-right">Délai (j. ouvrés)</th>
                <th className="px-4 py-3 text-right">ICTD</th>
                <th className="px-4 py-3">Certification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.fileId}>
                  <td className="px-4 py-3 font-mono text-xs text-navy-900">{r.fileNumber}</td>
                  <td className="px-4 py-3">{r.declarationType ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.shPositionCount ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.delaiJoursOuvres !== null ? r.delaiJoursOuvres : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.ictd !== null ? (
                      <>
                        {r.ictd.toFixed(2)}
                        {r.inputsCaptured < 5 ? (
                          <span className="ml-1 text-[10px] text-amber-600">base partielle</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-slate-400">non calculable</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.awaitingRevalidation ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                        À revalider
                      </span>
                    ) : r.validated ? (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-700">
                        Validé
                      </span>
                    ) : (
                      <span className="text-slate-400">Non validé</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        « Non calculable » signifie que le type de déclaration ou le régime DPI n&apos;a pas été
        saisi : la note de méthode laisse alors le dossier sans score plutôt que de lui en attribuer
        un de zéro. « Base partielle » signale les deux termes — nombre de factures fournisseur et
        nombre de cotations — que la plateforme ne collecte pas encore par dossier.
      </p>
    </div>
  );
}

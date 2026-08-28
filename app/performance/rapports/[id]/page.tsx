/**
 * One management report.
 *
 * A DRAFT renders live figures — that is what a draft is for, and they will
 * move until publication. A PUBLISHED report renders its frozen snapshot and
 * nothing else: the page does not recompute, so what a reader sees a year from
 * now is what management was briefed on.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getReport } from "@/lib/performance/report-read";
import { loadBiView } from "@/lib/performance/bi";
import { customPeriod } from "@/lib/performance/period";
import { REPORT_STATUS_FR } from "@/lib/performance/report";
import { ReportWorkflow } from "@/components/performance/report-workflow";

export const metadata: Metadata = { title: "Rapport de performance" };
export const dynamic = "force-dynamic";

const fr = (v: number | null, d = 2) =>
  v === null ? "non calculable" : v.toFixed(d).replace(".", ",");

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canEdit = hasPermission(permissions, "performance:report:create");
  const canPublish = hasPermission(permissions, "performance:report:publish");

  const report = await getReport(user.tenantId, id);
  if (!report) notFound();

  // Published → the frozen snapshot, always. Draft → live, because a draft is
  // a working document and pretending otherwise would freeze nothing useful.
  const snapshot =
    report.snapshot ??
    (await loadBiView(user.tenantId, customPeriod(report.periodStart, report.periodEnd))).snapshot;

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Gestion de la Performance"
        title={report.title}
        subtitle={`${report.periodLabel} · ${REPORT_STATUS_FR[report.status]}`}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/performance/rapports"
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              Retour
            </Link>
            {report.artifactStoragePath ? (
              <Link
                href={`/performance/rapports/${report.id}/pdf`}
                className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800"
              >
                Télécharger le PDF
              </Link>
            ) : null}
          </div>
        }
      />

      <ReportWorkflow
        id={report.id}
        status={report.status}
        executiveSummary={report.executiveSummary}
        managementCommentary={report.managementCommentary}
        canEdit={canEdit}
        canPublish={canPublish}
      />

      {report.status !== "PUBLIE" ? (
        <p className="text-[11px] text-amber-700">
          Brouillon — les chiffres ci-dessous sont calculés en direct et peuvent encore évoluer. Ils
          seront figés à la publication.
        </p>
      ) : (
        <p className="text-[11px] text-slate-400">
          Publié le {new Date(report.publishedAt!).toLocaleString("fr-FR")} par{" "}
          {report.publishedByEmail ?? "—"} · jeu de paramètres {report.parameterSetVersion} · moteur{" "}
          {report.engineVersion}
          {report.artifactSha256 ? ` · empreinte ${report.artifactSha256.slice(0, 12)}…` : ""}
        </p>
      )}

      {report.executiveSummary ? (
        <section className="surface p-5">
          <h2 className="text-sm font-semibold text-navy-900">Synthèse exécutive</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{report.executiveSummary}</p>
        </section>
      ) : null}

      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Activité globale</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Dossiers", String(snapshot.activity.dossierCount)],
            ["Collaborateurs", String(snapshot.activity.collaboratorCount)],
            ["ICTD total", fr(snapshot.activity.ictdTotal)],
            ["Délai moyen", fr(snapshot.delays.averageWorkingDays, 1)],
          ].map(([l, v]) => (
            <div key={l}>
              <p className="text-xs text-slate-500">{l}</p>
              <p className="text-lg font-semibold text-navy-900">{v}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Performance des collaborateurs</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Collaborateur</th>
                <th className="py-2 text-right">Dossiers</th>
                <th className="py-2 text-right">Jours trav.</th>
                <th className="py-2 text-right">ICTD</th>
                <th className="py-2">Fiabilité</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {snapshot.collaborators.map((c) => (
                <tr key={c.userId}>
                  <td className="py-2 text-navy-900">{c.name}</td>
                  <td className="py-2 text-right tabular-nums">{c.dossierCount}</td>
                  <td className="py-2 text-right tabular-nums">{c.workedDays.toFixed(1)}</td>
                  <td className="py-2 text-right tabular-nums">{fr(c.ictdTotal)}</td>
                  <td className="py-2 text-xs text-slate-600">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Points d&apos;attention</h2>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          <li>{snapshot.attention.nonCalculable} dossier(s) non calculables</li>
          <li>{snapshot.attention.awaitingRevalidation} dossier(s) à revalider</li>
          <li>{snapshot.attention.provisoire} collaborateur(s) en fiabilité provisoire</li>
        </ul>
      </section>

      {report.managementCommentary ? (
        <section className="surface p-5">
          <h2 className="text-sm font-semibold text-navy-900">Commentaire de direction</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {report.managementCommentary}
          </p>
        </section>
      ) : null}

      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Méthodologie et fiabilité</h2>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {snapshot.methodology.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {snapshot.methodology.unavailableIndicators.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-medium text-navy-900">Indicateurs non encore calculables</p>
            <ul className="mt-1 space-y-1 text-xs text-slate-600">
              {snapshot.methodology.unavailableIndicators.map((u) => (
                <li key={u.indicator}>
                  {u.indicator} — sources manquantes : {u.missing.join(" ; ")}.
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

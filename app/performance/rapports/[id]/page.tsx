/**
 * One management report — a briefing above, the evidence below.
 *
 * A DRAFT renders live figures; that is what a draft is for, and they move
 * until publication. A PUBLISHED report renders its frozen snapshot and nothing
 * else: the page does not recompute, so what a reader sees a year from now is
 * what management was briefed on.
 *
 * The briefing block derives from the SAME snapshot the PDF uses
 * (`buildBriefing`), so screen and paper cannot say different things. It draws
 * no conclusions — every line is a count or a state the platform holds, and the
 * interpretation belongs to the Responsable Performance, in her own section.
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
import { REPORT_STATUS_FR, PARAMETER_SET_VERSION, type ReportStatus } from "@/lib/performance/report";
import { buildBriefing, type AttentionSeverity } from "@/lib/performance/briefing";
import { ReportWorkflow } from "@/components/performance/report-workflow";
import { ReportProvenance } from "@/components/performance/report-provenance";

export const metadata: Metadata = { title: "Rapport de performance" };
export const dynamic = "force-dynamic";

const fr = (v: number | null, d = 2) =>
  v === null ? "non calculable" : v.toFixed(d).replace(".", ",");

const SEVERITY_STYLE: Record<AttentionSeverity, string> = {
  QUALITE: "border-amber-300 bg-amber-50/50",
  ATTENTION: "border-red-200 bg-red-50/40",
  INFO: "border-slate-200 bg-slate-50/60",
};
const SEVERITY_LABEL: Record<AttentionSeverity, string> = {
  QUALITE: "Qualité de donnée",
  ATTENTION: "Action requise",
  INFO: "Information",
};

/**
 * What this report IS, in its own words. Status-aware so the banner, the
 * heading and the available actions can never contradict one another.
 */
function LifecycleBanner({ status }: { status: ReportStatus }) {
  if (status === "PUBLIE") {
    return (
      <p className="rounded-md border border-teal-200 bg-teal-50/60 px-3 py-2 text-[11px] text-teal-900">
        <strong>Publié — figé.</strong> Les chiffres, le texte, l&apos;attribution et la
        méthodologie de ce rapport ne changent plus : ils enregistrent ce qui a été présenté à la
        direction. Pour une nouvelle analyse de la période, préparez un nouveau rapport plutôt que
        de modifier celui-ci.
      </p>
    );
  }
  if (status === "PRET_POUR_REVUE") {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2 text-[11px] text-amber-800">
        <strong>Prêt pour revue.</strong> Les chiffres restent calculés en direct et peuvent encore
        évoluer ; ils seront figés au moment de la publication.
      </p>
    );
  }
  return (
    <p className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-700">
      <strong>Brouillon.</strong> Les chiffres ci-dessous sont calculés en direct et peuvent encore
      évoluer. Ils seront figés à la publication.
    </p>
  );
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canEdit = hasPermission(permissions, "performance:report:create");
  const canPublish = hasPermission(permissions, "performance:report:publish");

  const report = await getReport(user.tenantId, id);
  if (!report) notFound();

  const snapshot =
    report.snapshot ??
    (await loadBiView(user.tenantId, customPeriod(report.periodStart, report.periodEnd))).snapshot;
  const briefing = buildBriefing(snapshot);

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
              // UAT-PERF-PDF-02 — a plain anchor, not next/link: the PDF is a
              // RESOURCE, not a route in this application, and opening it must
              // not take the reader out of Effitrans. `noopener` also severs
              // window.opener, so the PDF tab can never reach back into the
              // session that opened it.
              <a
                href={`/performance/rapports/${report.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800"
              >
                Ouvrir le PDF
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
            ) : null}
          </div>
        }
      />

      {/* UAT-PERF-LIFECYCLE-01 — one sentence per state. The banner used to say
          « Brouillon » for everything that was not published, which contradicted
          the heading on a report already marked « Prêt pour revue ». */}
      <LifecycleBanner status={report.status} />

      {/* ══════════════════════════ SYNTHÈSE EXÉCUTIVE ══════════════════════ */}
      <section className="surface border-t-4 border-navy-900 p-6">
        <h2 className="text-base font-semibold text-navy-900">Synthèse exécutive</h2>
        <p className="mt-1 text-[11px] text-slate-400">
          Chiffres établis par la plateforme à partir des données opérationnelles gouvernées.
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {briefing.kpis.map((k) => (
            <div key={k.label}>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">{k.label}</dt>
              <dd className="mt-0.5 text-xl font-semibold text-navy-900">{k.value}</dd>
              {k.qualifier ? (
                <p className="text-[11px] text-slate-500">{k.qualifier}</p>
              ) : null}
            </div>
          ))}
        </dl>

        <div
          className={`mt-4 rounded-md border px-3 py-2 ${
            briefing.capacityBasis.calendarPopulated
              ? "border-slate-200 bg-slate-50/60"
              : "border-amber-300 bg-amber-50/50"
          }`}
        >
          <p className="text-[11px] font-medium text-navy-900">
            Base de capacité : {briefing.capacityBasis.label}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">{briefing.capacityBasis.explanation}</p>
        </div>

        {report.executiveSummary ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              Lecture de la direction
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {report.executiveSummary}
            </p>
          </div>
        ) : null}
      </section>

      {/* ═════════════════ POINTS D'ATTENTION DE LA DIRECTION ═══════════════ */}
      <section className="surface p-6">
        <h2 className="text-base font-semibold text-navy-900">Points d&apos;attention de la Direction</h2>
        <p className="mt-1 text-[11px] text-slate-400">
          Constats déterministes issus des données. Aucune recommandation n&apos;est générée.
        </p>

        {briefing.findings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            Aucun point d&apos;attention sur cette période : données complètes, aucun dossier en
            attente de revalidation, calendrier renseigné.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {briefing.findings.map((f) => (
              <li key={f.label} className={`rounded-md border px-3 py-2 ${SEVERITY_STYLE[f.severity]}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-navy-900">
                    {f.count !== null ? `${f.count} · ` : ""}
                    {f.label}
                  </p>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    {SEVERITY_LABEL[f.severity]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{f.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ═══════════ COMMENTAIRE DE LA RESPONSABLE PERFORMANCE ══════════════ */}
      <section className="surface p-6">
        <h2 className="text-base font-semibold text-navy-900">
          Commentaire de la Responsable Performance
        </h2>
        <p className="mt-1 text-[11px] text-slate-400">
          Rédigé par {report.createdByEmail ?? "l'auteur du rapport"} — la lecture managériale des
          chiffres ci-dessus.
        </p>
        {report.managementCommentary ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
            {report.managementCommentary}
          </p>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            {report.status === "PUBLIE"
              ? "Aucun commentaire n'a été joint à ce rapport."
              : "Pas encore de commentaire — à rédiger ci-dessous avant la revue."}
          </p>
        )}
      </section>

      {/* ═══════════════════════════ PROVENANCE ════════════════════════════ */}
      <ReportProvenance report={report} currentParameterSetVersion={PARAMETER_SET_VERSION} />

      {/* ══════════════════════════ WORKFLOW ═══════════════════════════════ */}
      <ReportWorkflow
        id={report.id}
        status={report.status}
        executiveSummary={report.executiveSummary}
        managementCommentary={report.managementCommentary}
        canEdit={canEdit}
        canPublish={canPublish}
      />

      {/* ═══════════════════════ DÉTAIL / PREUVES ══════════════════════════ */}
      <div className="border-t border-slate-200 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Détail et pièces justificatives
        </h2>
      </div>

      <section className="surface p-5">
        <h3 className="text-sm font-semibold text-navy-900">Activité globale</h3>
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

        {snapshot.activity.byDeclarationType.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-medium text-navy-900">Typologie des déclarations</p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {snapshot.activity.byDeclarationType.map((t) => (
                <li key={t.type}>
                  {t.type} — {t.dossiers} dossier(s) · {fr(t.ictd)} UTD
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {snapshot.activity.byClient.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-medium text-navy-900">Clients — charge générée</p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {snapshot.activity.byClient.map((c) => (
                <li key={c.client}>
                  {c.client} — {c.dossiers} dossier(s) · {fr(c.ictd)} UTD
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="surface p-5">
        <h3 className="text-sm font-semibold text-navy-900">
          Performance des collaborateurs et capacité
        </h3>
        <p className="mt-1 text-[11px] text-slate-400">{briefing.capacityBasis.label}.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Collaborateur</th>
                <th className="py-2 text-right">Dossiers</th>
                <th className="py-2 text-right">Jours trav.</th>
                <th className="py-2 text-right">ICTD</th>
                <th className="py-2 text-right">ICTD / jour</th>
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
                  <td className="py-2 text-right tabular-nums">{fr(c.ictdPerDay)}</td>
                  <td className="py-2 text-xs text-slate-600">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {snapshot.delays.slowest.length > 0 ? (
        <section className="surface p-5">
          <h3 className="text-sm font-semibold text-navy-900">Délais et goulots d&apos;étranglement</h3>
          <p className="mt-1 text-[11px] text-slate-400">
            Dossier complet → BAE, en jours ouvrés. Les congés d&apos;un collaborateur n&apos;entrent
            pas dans ce calcul.
          </p>
          <ul className="mt-2 space-y-1">
            {snapshot.delays.slowest.map((d) => (
              <li key={d.fileNumber} className="flex justify-between text-xs">
                <span className="font-mono text-navy-900">{d.fileNumber}</span>
                <span className="tabular-nums text-slate-600">{d.days} j.</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="surface p-5">
        <h3 className="text-sm font-semibold text-navy-900">Méthodologie et fiabilité</h3>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {snapshot.methodology.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

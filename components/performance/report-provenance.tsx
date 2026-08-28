/**
 * Governance provenance — who, when, what period, what state, what methodology.
 *
 * Every value here is a PERSISTED fact read from the report row: `created_by`,
 * `created_at`, `published_by`, `published_at`, `parameter_set_version`,
 * `engine_version`, `artifact_renderer_version`, `artifact_sha256`. Nothing is
 * derived from the browser, and nothing is computed at render time.
 *
 * The one nuance worth stating rather than hiding: a DRAFT has no frozen
 * parameter version, because nothing has been frozen yet. It shows the version
 * currently in force, labelled « en vigueur » — the honest description of a
 * figure that will be stamped at publication and could in principle differ if
 * publication happened after a parameter change. A published report shows the
 * stamped one, labelled « figée ».
 */
import type { ReportDetail } from "@/lib/performance/report-read";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-xs text-navy-900">{children}</dd>
    </div>
  );
}

/** Server-rendered, so the formatting uses no client clock for the VALUE. */
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Dakar", dateStyle: "long", timeStyle: "short" });

export function ReportProvenance({
  report,
  currentParameterSetVersion,
}: {
  report: ReportDetail;
  currentParameterSetVersion: string;
}) {
  const published = report.status === "PUBLIE";

  return (
    <section className="surface p-5">
      <h2 className="text-sm font-semibold text-navy-900">Provenance et gouvernance</h2>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Row label="Préparé par">{report.createdByEmail ?? "—"}</Row>
        <Row label="Créé le">{stamp(report.createdAt)}</Row>
        <Row label="Période">
          {report.periodLabel}
          <span className="ml-1 text-slate-400">
            ({report.periodStart} → {report.periodEnd})
          </span>
        </Row>
        <Row label="Statut">
          {published ? "Publié — figé" : report.status === "PRET_POUR_REVUE" ? "Prêt pour revue" : "Brouillon"}
        </Row>

        <Row label="Version des paramètres">
          {published ? (
            <>
              {report.parameterSetVersion} <span className="text-slate-400">(figée)</span>
            </>
          ) : (
            <>
              {currentParameterSetVersion} <span className="text-slate-400">(en vigueur)</span>
            </>
          )}
        </Row>

        {published ? (
          <>
            <Row label="Publié par">{report.publishedByEmail ?? "—"}</Row>
            <Row label="Publié le">{report.publishedAt ? stamp(report.publishedAt) : "—"}</Row>
            <Row label="Moteur de calcul">{report.engineVersion ?? "—"}</Row>
            {report.artifactSha256 ? (
              <Row label="Empreinte du PDF (SHA-256)">
                <span
                  className="cursor-help font-mono text-[11px]"
                  title={report.artifactSha256}
                >
                  {report.artifactSha256.slice(0, 16)}…
                </span>
              </Row>
            ) : null}
          </>
        ) : null}
      </dl>

      <p className="mt-3 text-[11px] text-slate-400">
        Ces informations proviennent de l&apos;enregistrement du rapport en base : horodatages
        serveur, jamais l&apos;horloge d&apos;un poste de travail.
        {published
          ? " Un rapport publié est figé — son contenu, son attribution et sa méthodologie ne peuvent plus changer."
          : " Les chiffres d'un brouillon restent vivants et seront figés à la publication."}
      </p>
    </section>
  );
}

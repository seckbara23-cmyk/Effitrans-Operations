/**
 * Rapports & BI — the management intelligence surface.
 *
 * Five curated views over governed data, not a query builder. Every figure
 * comes from `loadBiView`, which calls the same `buildSnapshot` that
 * publication freezes — a dashboard and a published report cannot disagree.
 *
 * Missing stays missing. « non calculable », « Provisoire » and the named
 * unavailable indicators survive aggregation rather than being flattened into
 * zeros, because a zero that means "we did not measure" is the one number a
 * management report must never contain.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { resolvePeriod, dakarToday } from "@/lib/performance/period";
import { loadBiView } from "@/lib/performance/bi";
import { listReports } from "@/lib/performance/report-read";
import { REPORT_STATUS_FR, type ReportStatus } from "@/lib/performance/report";
import { PeriodPicker } from "@/components/performance/period-picker";
import { CreateReportForm } from "@/components/performance/create-report-form";

export const metadata: Metadata = { title: "Rapports & BI" };
export const dynamic = "force-dynamic";

const fr = (v: number | null, d = 2) =>
  v === null ? "non calculable" : v.toFixed(d).replace(".", ",");

const STATUS_STYLE: Record<ReportStatus, string> = {
  BROUILLON: "bg-slate-100 text-slate-600",
  PRET_POUR_REVUE: "bg-amber-50 text-amber-700",
  PUBLIE: "bg-teal-50 text-teal-700",
};

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="surface p-5">
      <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
      {subtitle ? <p className="mt-1 text-[11px] text-slate-400">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Bar({ label, value, max, note }: { label: string; value: number; max: number; note: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-500">{note}</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
        <div className="h-1.5 rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function RapportsBiPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string; anchor?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canCreate = hasPermission(permissions, "performance:report:create");

  const sp = (await searchParams) ?? {};
  const period = resolvePeriod(sp);
  const { snapshot: s, dossiers, clientNames } = await loadBiView(user.tenantId, period);
  const reports = await listReports(user.tenantId, 10);

  const maxType = Math.max(1, ...s.activity.byDeclarationType.map((t) => t.dossiers));
  const maxClient = Math.max(1, ...s.activity.byClient.map((c) => c.dossiers));
  const maxLoad = Math.max(1, ...s.collaborators.map((c) => c.ictdTotal ?? 0));

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Gestion de la Performance"
        title="Rapports & BI"
        subtitle={`Période : ${period.label}`}
      />

      <PeriodPicker current={period} today={dakarToday()} />

      {/* ------------------------------------------------------ 1. activité */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Dossiers traités", String(s.activity.dossierCount)],
          ["Collaborateurs", String(s.activity.collaboratorCount)],
          ["ICTD total (UTD)", fr(s.activity.ictdTotal)],
          ["Délai moyen (j. ouvrés)", fr(s.delays.averageWorkingDays, 1)],
        ].map(([label, value]) => (
          <div key={label} className="surface p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-navy-900">{value}</p>
          </div>
        ))}
      </div>

      {s.activity.dossierCount === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">
          Aucun dossier douanier sur cette période. Ce n&apos;est pas une performance nulle : il
          n&apos;y a rien à mesurer.
        </div>
      ) : (
        <>
          {/* ------------------------------------------- 2. charge & capacité */}
          <Panel
            title="Charge de travail et capacité"
            subtitle="ICTD par collaborateur sur la période, rapporté aux jours réellement travaillés."
          >
            <div className="overflow-x-auto">
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
                  {s.collaborators.map((c) => (
                    <tr key={c.userId}>
                      <td className="py-2 text-navy-900">{c.name}</td>
                      <td className="py-2 text-right tabular-nums">{c.dossierCount}</td>
                      <td className="py-2 text-right tabular-nums">{c.workedDays.toFixed(1)}</td>
                      <td className="py-2 text-right tabular-nums">{fr(c.ictdTotal)}</td>
                      <td className="py-2 text-right tabular-nums">{fr(c.ictdPerDay)}</td>
                      <td className="py-2 text-xs">
                        {c.status === "CLASSE" ? (
                          <span className="text-teal-700">Classé</span>
                        ) : c.status === "PROVISOIRE" ? (
                          <span className="text-amber-700">Provisoire</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              {s.collaborators.map((c) => (
                <Bar
                  key={c.userId}
                  label={c.name}
                  value={c.ictdTotal ?? 0}
                  max={maxLoad}
                  note={`${fr(c.ictdTotal)} UTD`}
                />
              ))}
            </div>
          </Panel>

          {/* --------------------------------- 3. typologie & clients */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Typologie des déclarations">
              {s.activity.byDeclarationType.length === 0 ? (
                <p className="text-xs text-slate-500">Aucun type de déclaration saisi.</p>
              ) : (
                s.activity.byDeclarationType.map((t) => (
                  <Bar
                    key={t.type}
                    label={t.type}
                    value={t.dossiers}
                    max={maxType}
                    note={`${t.dossiers} · ${fr(t.ictd)} UTD`}
                  />
                ))
              )}
            </Panel>

            <Panel title="Clients — charge générée" subtitle="Dix premiers par volume.">
              {s.activity.byClient.length === 0 ? (
                <p className="text-xs text-slate-500">Aucun client rattaché sur la période.</p>
              ) : (
                s.activity.byClient.map((c) => (
                  <Bar
                    key={c.client}
                    label={c.client}
                    value={c.dossiers}
                    max={maxClient}
                    note={`${c.dossiers} · ${fr(c.ictd)} UTD`}
                  />
                ))
              )}
            </Panel>
          </div>

          {/* ------------------------------------------ 4. délais / 5. attention */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Délais et goulots d'étranglement" subtitle="Dossier complet → BAE, en jours ouvrés.">
              <p className="text-xs text-slate-500">
                {s.delays.measured} dossier(s) avec un délai mesurable · moyenne{" "}
                {fr(s.delays.averageWorkingDays, 1)}
              </p>
              <ul className="mt-2 space-y-1">
                {s.delays.slowest.map((d) => (
                  <li key={d.fileNumber} className="flex justify-between text-xs">
                    <span className="font-mono text-navy-900">{d.fileNumber}</span>
                    <span className="tabular-nums text-slate-600">{d.days} j.</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Points d'attention management">
              <ul className="space-y-1 text-xs text-slate-600">
                <li>{s.attention.nonCalculable} dossier(s) non calculables — saisie douanière incomplète</li>
                <li>{s.attention.awaitingRevalidation} dossier(s) à revalider après correction</li>
                <li>{s.attention.provisoire} collaborateur(s) en fiabilité provisoire</li>
                <li>
                  {s.attention.calendarDays} jour(s) non travaillé(s) au calendrier
                  {s.attention.calendarDays === 0 ? " — seuls les week-ends sont exclus" : ""}
                </li>
              </ul>
            </Panel>
          </div>

          {/* ---------------------------------------------- drill-down */}
          <Panel
            title="Détail par dossier"
            subtitle="Chaque agrégat ci-dessus se lit ici, dossier par dossier."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2">Dossier</th>
                    <th className="py-2">Client</th>
                    <th className="py-2">Type</th>
                    <th className="py-2 text-right">NF</th>
                    <th className="py-2 text-right">Cot.</th>
                    <th className="py-2 text-right">SH</th>
                    <th className="py-2 text-right">Délai</th>
                    <th className="py-2 text-right">ICTD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dossiers.map((d) => (
                    <tr key={d.fileId}>
                      <td className="py-2">
                        <Link href={`/files/${d.fileId}`} className="font-mono text-xs text-teal-700 hover:underline">
                          {d.fileNumber}
                        </Link>
                      </td>
                      <td className="py-2 text-xs text-slate-600">
                        {d.clientId ? clientNames.get(d.clientId) ?? "—" : "—"}
                      </td>
                      <td className="py-2 text-xs">{d.declarationType ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums text-xs">{d.invoiceCount}</td>
                      <td className="py-2 text-right tabular-nums text-xs">{d.cotationCount}</td>
                      <td className="py-2 text-right tabular-nums text-xs">{d.shPositionCount ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums text-xs">
                        {d.delaiJoursOuvres ?? "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums text-xs">{fr(d.ictd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {/* --------------------------------------------------- reports */}
      <Panel
        title="Rapports de performance"
        subtitle="Un rapport publié est figé : il conserve exactement ce que la direction a lu."
      >
        {canCreate ? <CreateReportForm period={period} /> : null}

        {reports.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">Aucun rapport pour l&apos;instant.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/performance/rapports/${r.id}`} className="text-sm text-navy-900 hover:underline">
                  {r.title}
                </Link>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">{r.periodLabel}</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[r.status]}`}>
                    {REPORT_STATUS_FR[r.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-[11px] text-slate-400">
        Les chiffres de cette page proviennent du même calcul que celui figé à la publication
        d&apos;un rapport : un tableau de bord et un rapport publié ne peuvent pas diverger. Les
        valeurs manquantes restent manquantes — elles ne sont jamais converties en zéro.
      </p>
    </div>
  );
}

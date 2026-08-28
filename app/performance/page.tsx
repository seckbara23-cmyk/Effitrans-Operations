/**
 * Gestion de la Performance — Vue d'ensemble.
 *
 * Composition only: every figure comes from lib/performance/read.ts, which in
 * turn calls the engines proven against the frozen parity fixtures. Nothing is
 * computed here.
 *
 * The page states its own limits where it has them. A period with no captured
 * customs data shows « aucune donnée », never a zero — an empty month and a
 * month of zero-scoring dossiers are different facts about the business.
 */
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  dakarToday,
  monthPeriod,
  collaboratorPerformance,
  ICTD_TERMS,
  INDICATOR_READINESS,
} from "@/lib/performance/read";

export const metadata: Metadata = { title: "Gestion de la Performance" };
export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy-900">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

export default async function PerformanceOverviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ mois?: string }>;
}) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canManage = hasPermission(permissions, "performance:manage");

  const sp = (await searchParams) ?? {};
  const period = monthPeriod(sp.mois ?? dakarToday());
  const rows = await collaboratorPerformance(user.tenantId, period);

  const dossiers = rows.reduce((a, r) => a + r.dossierCount, 0);
  const scored = rows.filter((r) => r.ictdTotal !== null);
  const total =
    scored.length > 0
      ? Math.round(scored.reduce((a, r) => a + (r.ictdTotal ?? 0), 0) * 100) / 100
      : null;
  const classes = rows.filter((r) => r.status === "CLASSE").length;
  const provisoires = rows.filter((r) => r.status === "PROVISOIRE").length;

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Management"
        title="Gestion de la Performance"
        subtitle={`Période : ${period.label}${canManage ? "" : " — lecture seule"}`}
      />

      {rows.length === 0 ? (
        <div className="surface p-6">
          <p className="text-sm font-medium text-navy-900">Aucune donnée pour cette période.</p>
          <p className="mt-2 text-xs text-slate-500">
            L&apos;ICTD se calcule à partir des éléments douaniers saisis sur les dossiers. Tant
            qu&apos;aucune déclaration n&apos;a été saisie sur la période, il n&apos;y a rien à
            présenter — ce qui est différent d&apos;une performance nulle.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Collaborateurs évalués" value={String(rows.length)} />
            <Stat label="Dossiers" value={String(dossiers)} />
            <Stat label="ICTD total (UTD)" value={total !== null ? total.toFixed(2) : "—"} />
            <Stat
              label="Fiabilité"
              value={`${classes} classé(s)`}
              hint={provisoires > 0 ? `${provisoires} provisoire(s) — moins de 10 dossiers` : undefined}
            />
          </div>

          <div className="surface p-5">
            <h2 className="text-sm font-semibold text-navy-900">Base de calcul</h2>
            <p className="mt-2 text-xs text-slate-500">
              L&apos;ICTD par dossier compte sept termes, et la plateforme les alimente tous : cinq
              par la saisie douanière gouvernée, deux par dérivation — les factures commerciales
              vérifiées du dossier et les cotations réellement envoyées au client.
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-0.5 text-xs text-slate-600 sm:grid-cols-2">
              {ICTD_TERMS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-slate-400">
              Une facture commerciale déposée mais pas encore vérifiée ne compte pas encore : elle
              comptera à la vérification. Les rapports publiés sont figés et ne bougent pas.
            </p>
          </div>
        </>
      )}

      <div className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Indicateurs non encore calculables</h2>
        <p className="mt-2 text-xs text-slate-500">
          Les méthodes ICAM et IPAM sont figées et vérifiées, mais leurs sources ne sont pas encore
          collectées par la plateforme. Rien n&apos;est estimé à leur place.
        </p>
        <ul className="mt-3 space-y-2">
          {INDICATOR_READINESS.map((r) => (
            <li key={r.indicator} className="text-xs text-slate-600">
              <span className="font-medium text-navy-900">{r.indicator}</span> — il manque :{" "}
              {r.missing.join(" ; ")}.
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

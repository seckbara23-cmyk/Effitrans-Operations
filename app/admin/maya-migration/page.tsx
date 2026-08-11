/**
 * Administration → Reprise MAYA. REVIEW ONLY (MAYA-P0.5-C).
 * ---------------------------------------------------------------------------
 * Shows what a MAYA export contained, what validation made of it, and whether
 * every source row is accounted for. It offers NO action that would move data
 * into the platform — no « Importer », no « Appliquer », no « Migrer » — and
 * the page says so rather than leaving its absence to be discovered.
 *
 * Gate: `admin:config:manage` (an existing platform-administration authority;
 * no MAYA-specific role or permission exists).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listMayaBatches, listMayaIssues } from "@/lib/maya/staging/read";

export const metadata: Metadata = { title: "Reprise MAYA" };
export const dynamic = "force-dynamic";

const STATUS_FR: Record<string, string> = {
  STAGED: "Chargé — non validé",
  READY: "Prêt pour revue",
  READY_WITH_WARNINGS: "Prêt — avec réserves",
  REJECTED: "Rejeté",
  CANCELLED: "Retiré",
};

export default async function MayaMigrationPage({
  searchParams,
}: {
  searchParams?: { batch?: string };
}) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) notFound();

  const batches = await listMayaBatches(user.tenantId);
  const selected = searchParams?.batch
    ? batches.find((b) => b.id === searchParams.batch)
    : batches[0];
  const issues = selected ? await listMayaIssues(user.tenantId, selected.id) : [];

  const totals = batches.reduce(
    (a, b) => ({
      rows: a.rows + b.reconciliation.sourceRows,
      rejected: a.rejected + b.reconciliation.rejected,
      unresolved: a.unresolved + b.reconciliation.unresolved,
    }),
    { rows: 0, rejected: 0, unresolved: 0 },
  );

  return (
    <div className="animate-fade-in space-y-6">
      <Link href="/settings" className="text-sm text-teal-700 hover:underline">← Administration</Link>

      <PageHeader
        meta="Administration · Reprise MAYA"
        title="Reprise MAYA"
        subtitle="Préparation, validation et réconciliation des exports MAYA — revue seule."
      />

      {/* The honesty line: what this surface is, and what it deliberately is not. */}
      <p className="surface p-4 text-[11px] text-slate-600">
        Cet espace <strong>ne transfère rien</strong> vers la plateforme. Il reçoit un export MAYA
        réalisé hors ligne, le conserve tel quel, le normalise, le valide et prouve que chaque ligne
        source est comptée. Il n&apos;existe ni bouton « Importer », ni « Appliquer », ni « Migrer » :
        la reprise effective fera l&apos;objet d&apos;une phase distincte, après ratification métier
        (questions Q1, Q2 et Q5 encore ouvertes). Aucune connexion à MAYA n&apos;existe dans la
        plateforme — l&apos;export est produit par un opérateur.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Lots" value={String(batches.length)} />
        <StatCard label="Lignes source" value={String(totals.rows)} />
        <StatCard label="Lignes rejetées" value={String(totals.rejected)} tone={totals.rejected > 0 ? "amber" : "slate"} />
        <StatCard label="Références non résolues" value={String(totals.unresolved)} tone={totals.unresolved > 0 ? "amber" : "slate"} />
      </div>

      {batches.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">
          Aucun lot chargé. Les exports MAYA sont préparés hors ligne puis déposés par un
          administrateur ; rien n&apos;est lu depuis MAYA par la plateforme.
        </div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">Lot</th>
                <th className="px-4 py-2 font-medium">Artefact</th>
                <th className="px-4 py-2 font-medium">État</th>
                <th className="px-4 py-2 font-medium">Lignes</th>
                <th className="px-4 py-2 font-medium">Valides</th>
                <th className="px-4 py-2 font-medium">Réserves</th>
                <th className="px-4 py-2 font-medium">Rejets</th>
                <th className="px-4 py-2 font-medium">Doublons</th>
                <th className="px-4 py-2 font-medium">Non résolues</th>
                <th className="px-4 py-2 font-medium">Réconcilié</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const r = b.reconciliation;
                return (
                  <tr key={b.id} className={`border-b border-slate-50 ${selected?.id === b.id ? "bg-slate-50" : ""}`}>
                    <td className="px-4 py-2">
                      <Link href={`/admin/maya-migration?batch=${b.id}`} className="font-mono text-xs text-teal-700 hover:underline">
                        {b.batchNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{b.sourceArtifact ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{STATUS_FR[b.status] ?? b.status}</td>
                    <td className="px-4 py-2 tabular">{r.sourceRows}</td>
                    <td className="px-4 py-2 tabular">{r.valid}</td>
                    <td className="px-4 py-2 tabular">{r.warning}</td>
                    <td className="px-4 py-2 tabular">{r.rejected}</td>
                    <td className="px-4 py-2 tabular">{r.duplicate}</td>
                    <td className="px-4 py-2 tabular">{r.unresolved}</td>
                    <td className="px-4 py-2 text-xs">
                      {b.status === "STAGED" || b.status === "CANCELLED"
                        ? <span className="text-slate-400">non validé</span>
                        : r.balanced
                          ? <span className="text-teal-700">✓ {r.valid}+{r.warning}+{r.rejected}+{r.duplicate}={r.sourceRows}</span>
                          : <span className="text-red-700">écart — lignes perdues</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <section className="surface p-5">
          <h2 className="text-sm font-semibold text-navy-900">
            Constats de validation — {selected.batchNumber}
          </h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Une <strong>erreur</strong> signifie que la ligne n&apos;est pas exploitable telle quelle.
            Une <strong>réserve</strong> signifie que la ligne est saine mais qu&apos;une correspondance
            nous manque — un client non rapproché, un dossier mère pas encore chargé, ou un type MAYA
            volontairement non décomposé. Un workflow MAYA inconnu n&apos;est jamais une erreur.
          </p>
          {issues.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              {selected.status === "STAGED"
                ? "Lot non encore validé."
                : "Aucun constat — toutes les lignes sont exploitables."}
            </p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {issues.map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline gap-2">
                  <span className={i.severity === "ERROR" ? "text-red-700" : "text-amber-700"}>
                    {i.severity === "ERROR" ? "Erreur" : "Réserve"}
                  </span>
                  <span className="tabular text-xs text-slate-400">
                    ligne {i.sourceRowNumber ?? "—"}
                    {i.sourceDossierReference ? ` · ${i.sourceDossierReference}` : ""}
                  </span>
                  <span className="text-slate-700">{i.messageFr}</span>
                  {i.field && <span className="text-[11px] text-slate-400">({i.field})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

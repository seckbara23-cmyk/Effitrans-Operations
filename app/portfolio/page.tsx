/**
 * Account Manager client portfolio (Phase 5.0D-5, Deliverable 1).
 * ---------------------------------------------------------------------------
 * The client-facing owner's view. Flag-gated; 404s with the workspaces flag off.
 *
 * PRIVACY: no Collections notes, no promises, no disputes, no collector identity,
 * no maker-checker history. The payment summary is the safe one (total / paid /
 * outstanding) — the same figures finance shows, nothing about how a recovery is
 * being conducted.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { getAmPortfolio } from "@/lib/process/panels/account-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portefeuille clients" };

const money = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n));

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: { page?: string; all?: string };
}) {
  if (!globalKillSwitch().workspaces) notFound();

  const user = await requireUser();
  if (!(await getTenantProcessFlags(user.tenantId)).workspaces) notFound();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "process:read") || !hasPermission(permissions, "client:read")) {
    notFound();
  }

  // A supervisor may widen to the whole tenant; an AM sees their own clients.
  const canSeeAll = hasPermission(permissions, "file:read:all");
  const assignedOnly = !(canSeeAll && searchParams.all === "1");

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const portfolio = await getAmPortfolio(user.tenantId, user.id, permissions, {
    assignedOnly,
    page,
  });
  const pages = Math.max(1, Math.ceil(portfolio.total / portfolio.pageSize));

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">Portefeuille clients</h1>
        <p className="text-sm text-slate-600">
          {portfolio.total} client(s) · {assignedOnly ? "vos clients" : "tout le tenant"} ·{" "}
          {portfolio.telemetry.queries} requêtes (lecture groupée)
        </p>
        {canSeeAll && (
          <Link
            href={assignedOnly ? "/portfolio?all=1" : "/portfolio"}
            className="mt-1 inline-block text-xs text-blue-600 hover:underline"
          >
            {assignedOnly ? "Voir tous les clients" : "Voir seulement mes clients"}
          </Link>
        )}
      </header>

      {portfolio.clients.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucun client ne vous est affecté.
        </div>
      )}

      {portfolio.clients.map((c) => (
        <section key={c.clientId} className="rounded-lg border border-slate-200 bg-white p-4">
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <Link href={`/clients/${c.clientId}`} className="text-sm font-semibold text-navy-900 hover:text-teal-700">
                {c.clientName}
              </Link>
              <span className="ml-2 text-xs text-slate-500">{c.activeDossiers} dossier(s) actif(s)</span>
            </div>
            <div className="text-right text-xs text-slate-500">
              {c.lastCommunicationAt ? (
                <>
                  Dernière communication : {new Date(c.lastCommunicationAt).toLocaleDateString("fr-FR")}
                  {c.lastCommunicationSubject && (
                    <div className="text-[11px] text-slate-400">{c.lastCommunicationSubject}</div>
                  )}
                </>
              ) : (
                <span className="text-slate-400">Aucune communication</span>
              )}
              {c.unansweredCommunications > 0 && (
                <div className="text-[11px] font-medium text-amber-700">
                  {c.unansweredCommunications} message(s) non aboutis
                </div>
              )}
            </div>
          </header>

          {c.dossiers.length === 0 ? (
            <p className="text-xs text-slate-400">Aucun dossier.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-1.5">Dossier</th>
                    <th className="py-1.5">Étape officielle</th>
                    <th className="py-1.5">Blocage</th>
                    <th className="py-1.5">Documents attendus</th>
                    <th className="py-1.5 text-right">Facturation</th>
                    <th className="py-1.5">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {c.dossiers.map((d) => (
                    <tr key={d.fileId}>
                      <td className="py-2">
                        <Link href={`/files/${d.fileId}`} className="tabular font-medium text-navy-900 hover:text-teal-700">
                          {d.fileNumber}
                        </Link>
                        {!d.acknowledgmentSent && (
                          <div className="text-[10px] text-amber-700">Accusé de réception non envoyé</div>
                        )}
                      </td>
                      <td className="py-2 text-slate-700">
                        {d.stepNumber ? `${d.stepNumber}. ` : ""}
                        {d.stepLabel ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="py-2">
                        {d.blocker ? (
                          <span className="text-red-600">{d.blocker}</span>
                        ) : d.priorityReason ? (
                          <span className="text-amber-700">{d.priorityReason}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2 text-slate-600">
                        {d.documentsAwaited > 0 ? `${d.documentsAwaited} à valider` : "—"}
                      </td>
                      <td className="py-2 text-right tabular">
                        {d.invoiceIssued ? (
                          <>
                            <div className="text-slate-500">{money(d.payment.total)}</div>
                            <div className="font-medium text-navy-900">
                              solde {money(d.payment.outstanding)}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">Non facturé</span>
                        )}
                      </td>
                      <td className="py-2">
                        {d.closed ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            Clôturé
                          </span>
                        ) : (
                          <span className="text-slate-500">{d.deliveryStatus}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          <Link
            href={`/portfolio?page=${Math.max(1, page - 1)}`}
            className={`rounded border px-3 py-1.5 ${page <= 1 ? "pointer-events-none border-slate-100 text-slate-300" : "border-slate-200 text-slate-700"}`}
          >
            Précédent
          </Link>
          <span className="text-xs text-slate-500">
            Page {page} / {pages}
          </span>
          <Link
            href={`/portfolio?page=${Math.min(pages, page + 1)}`}
            className={`rounded border px-3 py-1.5 ${page >= pages ? "pointer-events-none border-slate-100 text-slate-300" : "border-slate-200 text-slate-700"}`}
          >
            Suivant
          </Link>
        </nav>
      )}
    </main>
  );
}

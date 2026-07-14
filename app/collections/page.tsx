/**
 * Collections workspace (Phase 5.0D-4, Deliverable 9).
 * ---------------------------------------------------------------------------
 * Server-side pagination and filters — the browser never receives the whole book.
 * Bounded batch reads (no N+1). Every priority shows its reason.
 *
 * Nothing here can close a dossier: closure is a separate, explicitly permissioned
 * action (process:close), and the row only reports its blockers.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getProcessFlags } from "@/lib/process/config";
import { getCollectionsQueue, type CollectionsFilters } from "@/lib/collections/service";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/collections/aging";
import { CollectionsRowActions } from "@/components/collections/collections-row-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recouvrement" };

const money = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n));

const BUCKET_TONE: Record<string, string> = {
  OVER_90_DAYS: "bg-red-50 text-red-700 border-red-200",
  "61_TO_90_DAYS": "bg-orange-50 text-orange-700 border-orange-200",
  "31_TO_60_DAYS": "bg-amber-50 text-amber-700 border-amber-200",
  "1_TO_30_DAYS": "bg-yellow-50 text-yellow-800 border-yellow-200",
  DUE_TODAY: "bg-blue-50 text-blue-700 border-blue-200",
  NOT_DUE: "bg-slate-50 text-slate-600 border-slate-200",
  DUE_DATE_MISSING: "bg-slate-50 text-slate-500 border-slate-200",
  DISPUTED: "bg-purple-50 text-purple-700 border-purple-200",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

type Search = {
  bucket?: string;
  page?: string;
  mine?: string;
  unassigned?: string;
  disputed?: string;
  missed?: string;
  promise?: string;
  noFollowUp?: string;
  ready?: string;
  verify?: string;
  partial?: string;
  paid?: string;
  q?: string;
};

export default async function CollectionsPage({ searchParams }: { searchParams: Search }) {
  const flags = getProcessFlags();
  if (!flags.enabled || !flags.collections) notFound();

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "collections:manage")) notFound();

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const filters: CollectionsFilters = {
    bucket: AGING_BUCKETS.includes(searchParams.bucket as AgingBucket)
      ? (searchParams.bucket as AgingBucket)
      : undefined,
    assigneeId: searchParams.mine === "1" ? user.id : undefined,
    unassigned: searchParams.unassigned === "1",
    disputed: searchParams.disputed === "1",
    missedPromise: searchParams.missed === "1",
    promiseDue: searchParams.promise === "1",
    noRecentFollowUp: searchParams.noFollowUp === "1",
    closureReady: searchParams.ready === "1",
    pendingVerification: searchParams.verify === "1",
    partiallyPaid: searchParams.partial === "1",
    fullyPaid: searchParams.paid === "1",
    search: searchParams.q,
  };

  const { rows, total, pageSize } = await getCollectionsQueue(
    user.tenantId,
    user.id,
    permissions,
    filters,
    page,
  );
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const canClose = hasPermission(permissions, "process:close");

  const chip = "rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-slate-50";

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">Recouvrement</h1>
        <p className="text-sm text-slate-600">
          Étape officielle 26 · {total} créance(s) · le paiement intégral ne clôture pas un dossier
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/collections" className={`${chip} border-slate-200 text-slate-600`}>
          Toutes
        </Link>
        <Link href="/collections?mine=1" className={`${chip} border-slate-200 text-slate-600`}>
          Les miennes
        </Link>
        <Link href="/collections?unassigned=1" className={`${chip} border-slate-200 text-slate-600`}>
          Non affectées
        </Link>
        <Link href="/collections?missed=1" className={`${chip} border-slate-200 text-slate-600`}>
          Promesses non tenues
        </Link>
        <Link href="/collections?promise=1" className={`${chip} border-slate-200 text-slate-600`}>
          Promesses en cours
        </Link>
        <Link href="/collections?disputed=1" className={`${chip} border-slate-200 text-slate-600`}>
          En litige
        </Link>
        <Link href="/collections?noFollowUp=1" className={`${chip} border-slate-200 text-slate-600`}>
          Sans relance
        </Link>
        <Link href="/collections?verify=1" className={`${chip} border-slate-200 text-slate-600`}>
          Paiement à vérifier
        </Link>
        <Link href="/collections?partial=1" className={`${chip} border-slate-200 text-slate-600`}>
          Partiellement payées
        </Link>
        <Link href="/collections?ready=1" className={`${chip} border-slate-200 text-slate-600`}>
          Prêtes à clôturer
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucune créance dans cette vue.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Dossier / Client</th>
                <th className="px-4 py-2.5">Échéance</th>
                <th className="px-4 py-2.5 text-right">Montant / Payé / Solde</th>
                <th className="px-4 py-2.5">Âge</th>
                <th className="px-4 py-2.5">Relance / Promesse</th>
                <th className="px-4 py-2.5">Priorité</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.invoiceId} className="align-top hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link href={`/files/${r.fileId}`} className="tabular font-medium text-navy-900 hover:text-teal-700">
                      {r.fileNumber}
                    </Link>
                    <div className="text-xs text-slate-500">{r.clientName}</div>
                    <div className="text-[11px] text-slate-400">{r.invoiceNumber ?? "—"}</div>
                    {r.assigneeName && (
                      <div className="text-[11px] text-slate-400">Chargé : {r.assigneeName}</div>
                    )}
                  </td>

                  <td className="px-4 py-3 text-xs text-slate-600">
                    {r.dueDate ?? <span className="text-slate-400">Non définie</span>}
                  </td>

                  <td className="px-4 py-3 text-right text-xs tabular">
                    <div className="text-slate-500">{money(r.total)}</div>
                    <div className="text-emerald-700">{money(r.paid)}</div>
                    <div className="font-semibold text-navy-900">{money(r.outstanding)}</div>
                    {r.paymentAwaitingVerification && (
                      <div className="text-[10px] text-amber-700">Paiement à vérifier</div>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${BUCKET_TONE[r.aging.bucket] ?? BUCKET_TONE.NOT_DUE}`}
                    >
                      {r.aging.labelFr}
                    </span>
                    {r.dispute.open && (
                      <div className="mt-1 text-[10px] text-purple-700">{r.dispute.category}</div>
                    )}
                  </td>

                  <td className="px-4 py-3 text-xs">
                    <div className="text-slate-600">
                      {r.lastFollowUpAt
                        ? `Dernière : ${new Date(r.lastFollowUpAt).toLocaleDateString("fr-FR")}`
                        : "Aucune relance"}
                    </div>
                    {r.promise.status !== "none" && (
                      <div
                        className={
                          r.promise.status === "missed" ? "text-red-600" : "text-slate-500"
                        }
                      >
                        Promesse {r.promise.status === "missed" ? "non tenue" : r.promise.status}
                        {r.promise.promisedDate ? ` (${r.promise.promisedDate})` : ""}
                        {r.promise.supersededCount > 0 && ` · ${r.promise.supersededCount} antérieure(s)`}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-slate-700">{r.priority.level}</span>
                    <ul className="mt-0.5 space-y-0.5">
                      {r.priority.reasons.slice(0, 2).map((x) => (
                        <li key={x.code} className="text-[10px] text-slate-500">
                          {x.labelFr}
                        </li>
                      ))}
                    </ul>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <CollectionsRowActions row={r} canClose={canClose} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          <Link
            href={`/collections?page=${Math.max(1, page - 1)}`}
            className={`rounded border px-3 py-1.5 ${page <= 1 ? "pointer-events-none border-slate-100 text-slate-300" : "border-slate-200 text-slate-700"}`}
          >
            Précédent
          </Link>
          <span className="text-xs text-slate-500">
            Page {page} / {pages}
          </span>
          <Link
            href={`/collections?page=${Math.min(pages, page + 1)}`}
            className={`rounded border px-3 py-1.5 ${page >= pages ? "pointer-events-none border-slate-100 text-slate-300" : "border-slate-200 text-slate-700"}`}
          >
            Suivant
          </Link>
        </nav>
      )}
    </main>
  );
}

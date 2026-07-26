/**
 * Autorisations de Dépenses — ma file de visas (Phase 11.0D). SERVER.
 * ---------------------------------------------------------------------------
 * The documents waiting for THIS user's signature. Server-gated on
 * finance:expense:read; the queue reader additionally requires
 * finance:expense:sign and evaluates each document with the same pure chain
 * evaluator the sign action uses — so a row appears here if and only if the
 * caller could genuinely sign it. Nothing halted on an unnamed signer is listed:
 * it is not anyone's work until the business names them (BLK-FIN-2).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getExpenseApprovalQueue } from "@/lib/finance/expense/readers";
import { fmtNumber } from "@/lib/reports/templates";

export const metadata: Metadata = { title: "Visas à apposer" };
export const dynamic = "force-dynamic";

const frDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");

export default async function ExpenseApprovalQueuePage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "finance:expense:read")) notFound();
  const canSign = hasPermission(permissions, "finance:expense:sign");

  const queue = canSign ? await getExpenseApprovalQueue() : [];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Finance · Autorisations de dépenses"
        title="Visas à apposer"
        subtitle="Les autorisations de dépenses dont vous êtes le signataire attendu."
        actions={
          <Link href="/finance/autorisations-depenses" className="text-sm text-slate-500 hover:text-navy-900">
            Retour au registre
          </Link>
        }
      />

      {!canSign ? (
        <div className="surface p-6 text-sm text-slate-600">
          Vous n'êtes signataire d'aucune étape du circuit de visas.
        </div>
      ) : queue.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">
          Aucune autorisation n'attend votre visa pour le moment.
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">N° autorisation</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Bénéficiaire</th>
                  <th className="px-4 py-3 font-semibold">Montant</th>
                  <th className="px-4 py-3 font-semibold">Votre étape</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/finance/autorisations-depenses/${q.id}`}
                        className="tabular font-medium text-teal-700 hover:underline"
                      >
                        {q.authorizationNumber ?? "Brouillon"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{frDate(q.createdAt)}</td>
                    <td className="px-4 py-3 text-navy-900">{q.beneficiary}</td>
                    <td className="px-4 py-3 tabular text-slate-600">
                      {fmtNumber(q.amount)} {q.currency}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {q.stepOrdinal}. {q.stepLabelFr}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

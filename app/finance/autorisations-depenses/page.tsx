/**
 * Autorisations de Dépenses — register (Phase 11.0C). SERVER.
 * ---------------------------------------------------------------------------
 * The tenant's expense-authorization register: the digital equivalent of the
 * binder the paper forms live in today. Server-gated on finance:expense:read
 * (the 11.0B permission family — no new permission); the create control appears
 * only for finance:expense:create holders, and its action re-checks server-side.
 *
 * Reads exclusively through the bounded-context readers, which are themselves
 * permission-gated and tenant-scoped, and degrade to an empty list when the
 * migration has not been applied yet.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listExpenseAuthorizations } from "@/lib/finance/expense/readers";
import { AUTHORIZATION_STATUS_LABELS_FR, type AuthorizationStatus } from "@/lib/finance/expense/types";
import { fmtNumber } from "@/lib/reports/templates";

export const metadata: Metadata = { title: "Autorisations de dépenses" };
export const dynamic = "force-dynamic";

/** Neutral status chips — no favourable/unfavourable colouring on a lifecycle. */
const TONE: Record<AuthorizationStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SUBMITTED: "bg-teal-50 text-teal-700",
  IN_APPROVAL: "bg-amber-50 text-amber-700",
  RETURNED: "bg-amber-50 text-amber-700",
  REJECTED: "bg-red-50 text-red-700",
  APPROVED: "bg-teal-50 text-teal-700",
  CANCELLED: "bg-slate-100 text-slate-500",
  SUPERSEDED: "bg-slate-100 text-slate-500",
};

const frDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");

export default async function ExpenseAuthorizationsPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "finance:expense:read")) notFound();
  const canCreate = hasPermission(permissions, "finance:expense:create");

  const authorizations = await listExpenseAuthorizations();

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Finance"
        title="Autorisations de dépenses"
        subtitle="Registre des autorisations de dépenses — brouillons, soumissions et documents approuvés."
        actions={
          canCreate ? (
            <Link
              href="/finance/autorisations-depenses/nouvelle"
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
            >
              + Nouvelle autorisation
            </Link>
          ) : null
        }
      />

      {authorizations.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">
          Aucune autorisation de dépenses n'a encore été créée.
          {canCreate && " Utilisez « Nouvelle autorisation » pour établir la première."}
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">N° autorisation</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Bénéficiaire</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Montant</th>
                  <th className="px-4 py-3 font-semibold">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {authorizations.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/finance/autorisations-depenses/${a.id}`}
                        className="tabular font-medium text-teal-700 hover:underline"
                      >
                        {a.authorizationNumber ?? "Brouillon"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{frDate(a.createdAt)}</td>
                    <td className="px-4 py-3 text-navy-900">{a.beneficiary}</td>
                    <td className="px-4 py-3 text-slate-600">{a.expenseType ?? "—"}</td>
                    <td className="px-4 py-3 tabular text-slate-600">
                      {fmtNumber(a.amount)} {a.currency}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[a.status]}`}>
                        {AUTHORIZATION_STATUS_LABELS_FR[a.status]}
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

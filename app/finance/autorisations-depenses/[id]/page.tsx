/**
 * Autorisation de Dépenses — document detail (Phase 11.0C). SERVER.
 * ---------------------------------------------------------------------------
 * The one screen an operator works the document from: the paper fields (editable
 * while DRAFT/RETURNED, read-only afterwards), the supporting documents, the
 * immutable version history, the signature section, and the print/submit
 * controls.
 *
 * Server-gated on finance:expense:read; every control is additionally gated on
 * its own permission AND the document's state — and each underlying action
 * re-asserts both, because a rendered button is never authorization.
 *
 * The signature section is DISPLAY-ONLY in this phase: no visa can be recorded
 * until 11.0D, so the boxes state plainly that the printed form is signed by
 * hand — and the two steps whose signer the business has not yet named are shown
 * as unconfigured rather than silently omitted (BLK-FIN-1 / BLK-FIN-2).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  getExpenseAuthorizationDetail,
  getExpenseAuthorizationVersions,
  listExpenseAttachments,
} from "@/lib/finance/expense/readers";
import {
  AUTHORIZATION_EDITABLE_STATUSES,
  AUTHORIZATION_STATUS_LABELS_FR,
  isUnboundVisaStep,
  type AuthorizationStatus,
} from "@/lib/finance/expense/types";
import { AUTHORIZATION_VISA_BOXES } from "@/lib/finance/expense/template-map";
import { AuthorizationForm } from "@/components/finance/expense/authorization-form";
import { AuthorizationActions } from "@/components/finance/expense/authorization-actions";
import { AttachmentManager } from "@/components/finance/expense/attachment-manager";
import { fmtNumber } from "@/lib/reports/templates";

export const metadata: Metadata = { title: "Autorisation de dépenses" };
export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-navy-900">{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

const frDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");

export default async function ExpenseAuthorizationDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "finance:expense:read")) notFound();

  const doc = await getExpenseAuthorizationDetail(params.id);
  if (!doc) notFound();

  const [versions, attachments] = await Promise.all([
    getExpenseAuthorizationVersions(doc.id),
    listExpenseAttachments(doc.id),
  ]);

  const editable = AUTHORIZATION_EDITABLE_STATUSES.includes(doc.status as AuthorizationStatus);
  const canCreate = hasPermission(permissions, "finance:expense:create");
  const canSubmit = hasPermission(permissions, "finance:expense:submit");
  const canExport = hasPermission(permissions, "finance:expense:export");

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Finance · Autorisations de dépenses"
        title={doc.authorizationNumber ?? "Brouillon d'autorisation"}
        subtitle={`${AUTHORIZATION_STATUS_LABELS_FR[doc.status]} · ${doc.beneficiary} · ${fmtNumber(doc.amount)} ${doc.currency}`}
        actions={
          <Link href="/finance/autorisations-depenses" className="text-sm text-slate-500 hover:text-navy-900">
            Retour au registre
          </Link>
        }
      />

      <AuthorizationActions
        id={doc.id}
        status={doc.status}
        canSubmit={canSubmit}
        canExport={canExport}
        hasVoucher={Boolean(doc.voucherId)}
      />

      {editable && canCreate ? (
        <AuthorizationForm
          mode="edit"
          authorizationId={doc.id}
          initial={{
            accountNumber: doc.accountNumber ?? "",
            fileNumber: doc.fileNumber ?? "",
            registrationNumber: doc.registrationNumber ?? "",
            expenseType: doc.expenseType ?? "",
            weightKg: doc.weightKg == null ? "" : String(doc.weightKg),
            beneficiary: doc.beneficiary,
            amount: String(doc.amount),
            currency: doc.currency,
            reason: doc.reason,
          }}
        />
      ) : (
        <section className="surface space-y-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-navy-900">Document</h2>
            {!editable && (
              <span className="text-xs text-slate-400">
                Document figé — modification impossible à ce stade
              </span>
            )}
          </div>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="N° compte" value={doc.accountNumber} />
            <Field label="N° dossier" value={doc.fileNumber} />
            <Field label="N° immatriculation" value={doc.registrationNumber} />
            <Field label="Type" value={doc.expenseType} />
            <Field label="Poids (KG)" value={doc.weightKg == null ? null : fmtNumber(doc.weightKg)} />
            <Field label="Bénéficiaire" value={doc.beneficiary} />
            <Field label="Montant" value={`${fmtNumber(doc.amount)} ${doc.currency}`} />
            <Field label="Nom de l'agent" value={doc.requesterName} />
            <Field label="Date" value={frDate(doc.createdAt)} />
          </dl>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Montant en lettres" value={doc.amountInWords} />
            <Field label="Observations / Motif" value={doc.reason} />
          </div>
        </section>
      )}

      <AttachmentManager
        authorizationId={doc.id}
        attachments={attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          kind: a.kind,
          byteSize: a.byteSize,
          retiredAt: a.retiredAt,
        }))}
        editable={editable && canCreate}
      />

      {/* Signature section — display only in 11.0C (no visa can be recorded yet). */}
      <section className="surface space-y-3 p-4">
        <h2 className="text-sm font-semibold text-navy-900">Visas et approbations</h2>
        <p className="text-xs text-slate-500">
          Les visas électroniques seront activés en phase 11.0D. Le document imprimé porte les sept cases de
          visa dans l'ordre du formulaire et se signe à la main, comme aujourd'hui.
        </p>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {AUTHORIZATION_VISA_BOXES.map((v) => (
            <li key={v.code} className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold text-navy-900">
                {v.ordinal}. {v.label}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {isUnboundVisaStep(v.code) ? "Signataire non configuré" : "En attente"}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="surface space-y-3 p-4">
        <h2 className="text-sm font-semibold text-navy-900">Versions</h2>
        {versions.length === 0 ? (
          <p className="text-xs text-slate-500">
            Aucune version figée — la première est créée à la soumission du document.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="font-medium text-navy-900">Version {v.versionNumber}</span>
                <span className="text-xs text-slate-400">{frDate(v.createdAt)}</span>
                <span className="tabular ml-auto text-[11px] text-slate-400">
                  {v.contentSha256.slice(0, 12)}…
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

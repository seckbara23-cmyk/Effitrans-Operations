import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  getQuotation, listLines, listVersions, getRequest,
  COMMERCIAL_READ_PERMISSIONS, QUOTATION_STATUS_FR, ACCEPTANCE_KIND_FR,
} from "@/lib/commercial/service";
import { quotationTotals, formatAmountMinor, formatQuantityMilli, formatRateBp } from "@/lib/commercial/money";
import {
  canEditLines, canSubmit, canValidate, canSend, canRecordDecision,
  canRevise, canCancel, validationBlockedReason,
  canConvert, conversionBlockedReason,
} from "@/lib/commercial/queues";
import { ConversionPanel } from "@/components/commercial/conversion-panel";
import { readQuotationTimeline } from "@/lib/workflow/events/readers";
import { QuotationStudio } from "@/components/commercial/quotation-studio";

export const metadata: Metadata = { title: "Cotation" };
export const dynamic = "force-dynamic";

/**
 * EC-3C — one quotation: its lines, its version history, what the current user
 * may do with it, and its Digital-LOS timeline.
 *
 * Previous versions are SHOWN, never edited: a superseded offer is what the
 * customer was given at the time.
 */
export default async function QuotationDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!COMMERCIAL_READ_PERMISSIONS.some((p) => hasPermission(permissions, p))) notFound();

  const quotation = await getQuotation(user.tenantId, params.id);
  if (!quotation) notFound();

  const [lines, versions, request, timeline] = await Promise.all([
    listLines(user.tenantId, quotation.id),
    listVersions(user.tenantId, quotation.requestId),
    getRequest(user.tenantId, quotation.requestId),
    readQuotationTimeline(user.tenantId, quotation.id),
  ]);

  const totals = quotationTotals(lines);
  const caps = {
    editLines: canEditLines(quotation, permissions),
    submit: canSubmit(quotation, permissions),
    validate: canValidate(quotation, permissions, user.id),
    send: canSend(quotation, permissions),
    recordDecision: canRecordDecision(quotation, permissions),
    revise: canRevise(quotation, permissions),
    cancel: canCancel(quotation, permissions),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${quotation.quotationNumber ?? "Brouillon"} · v${quotation.version}`}
        subtitle={request?.clientName ?? undefined}
        meta={`${QUOTATION_STATUS_FR[quotation.status]}${request?.subject ? ` · ${request.subject}` : ""}`}
        actions={<Link href="/commercial" className="text-sm text-navy-900 hover:underline">← Commercial</Link>}
      />

      {/* Read-only view of the lines as they stand. The editor below appears only
          for an agent on a DRAFT; everyone permitted to read sees this. */}
      <section className="surface p-5">
        <h2 className="mb-3 text-base font-semibold text-navy-900">Détail</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune ligne enregistrée.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2">Désignation</th>
                <th className="pb-2 text-right">Qté</th>
                <th className="pb-2 text-right">P.U.</th>
                <th className="pb-2 text-right">TVA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 text-navy-900">{l.description}</td>
                  <td className="py-2 text-right tabular">{formatQuantityMilli(l.quantityMilli)}</td>
                  <td className="py-2 text-right tabular">
                    {formatAmountMinor(l.unitAmountMinor, quotation.currency)}
                  </td>
                  <td className="py-2 text-right tabular">{formatRateBp(l.taxRateBp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">Total HT</dt>
            <dd className="tabular text-navy-900">{formatAmountMinor(totals.subtotalMinor, quotation.currency)}</dd>
          </div>
          {/* No tax block when nothing carries a rate — the platform encodes no tax rule. */}
          {!totals.taxFree ? (
            <div className="flex justify-between">
              <dt className="text-slate-600">Taxes</dt>
              <dd className="tabular text-navy-900">{formatAmountMinor(totals.taxMinor, quotation.currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between font-semibold">
            <dt className="text-navy-900">Total</dt>
            <dd className="tabular text-navy-900">{formatAmountMinor(totals.totalMinor, quotation.currency)}</dd>
          </div>
        </dl>

        {quotation.acceptanceKind ? (
          <p className="mt-4 text-sm text-teal-800">
            Acceptée le {quotation.acceptedOn ?? "—"} · preuve :{" "}
            {ACCEPTANCE_KIND_FR[quotation.acceptanceKind]}
          </p>
        ) : null}
        {/* EC-3D — once converted, Operations owns the dossier and Commercial is
            read-only. The link is the handover, stated plainly. */}
        {quotation.convertedFileId ? (
          <p className="mt-4 text-sm text-navy-900">
            Convertie en dossier le{" "}
            {quotation.convertedAt
              ? new Date(quotation.convertedAt).toLocaleDateString("fr-FR")
              : "—"}{" "}
            ·{" "}
            <Link href={`/files/${quotation.convertedFileId}`} className="underline">
              ouvrir le dossier
            </Link>
            . Les Opérations en sont propriétaires ; le Commercial n&apos;agit plus dessus.
          </p>
        ) : null}
        {quotation.rejectionReasonCode ? (
          <p className="mt-4 text-sm text-amber-800">
            Refusée en validation interne · motif : {quotation.rejectionReasonCode}
          </p>
        ) : null}
      </section>

      <QuotationStudio
        quotationId={quotation.id}
        currency={quotation.currency}
        caps={caps}
        initialLines={lines.map((l) => ({
          description: l.description,
          quantity: String(l.quantityMilli / 1000),
          unitAmount: String(l.unitAmountMinor / 100),
          taxRate: String(l.taxRateBp / 100),
        }))}
        validationBlocked={validationBlockedReason(quotation, permissions, user.id)}
        hasArtifact={Boolean(quotation.artifactStoragePath)}
      />

      {/* Conversion — only for an ACCEPTED quotation, and only for a seat that
          holds the Operations authority. Others see why, not a dead button. */}
      {quotation.status === "ACCEPTED" && !quotation.convertedFileId ? (
        canConvert(quotation, permissions) ? (
          <ConversionPanel quotationId={quotation.id} blockedReason={null} />
        ) : (
          <ConversionPanel
            quotationId={quotation.id}
            blockedReason={conversionBlockedReason(quotation, permissions)}
          />
        )
      ) : null}

      {versions.length > 1 ? (
        <section className="surface p-5">
          <h2 className="mb-3 text-base font-semibold text-navy-900">Versions</h2>
          <ul className="divide-y divide-slate-100">
            {versions.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <Link href={`/commercial/quotations/${v.id}`}
                  className={v.id === quotation.id ? "font-semibold text-navy-900" : "text-navy-900 hover:underline"}>
                  v{v.version} {v.quotationNumber ? `· ${v.quotationNumber}` : ""}
                </Link>
                <span className="text-xs text-slate-400">
                  {QUOTATION_STATUS_FR[v.status]} · {new Date(v.createdAt).toLocaleDateString("fr-FR")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="surface p-5">
        <h2 className="mb-3 text-base font-semibold text-navy-900">Historique</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun évènement.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {timeline.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-slate-700">{e.labelFr}</span>
                <span className="text-xs text-slate-400">
                  {new Date(e.occurredAt).toLocaleString("fr-FR")}
                  {e.actorName ? ` · ${e.actorName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

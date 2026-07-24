import Link from "next/link";
import { StatCard } from "@/components/departments/stat-card";
import { CockpitSectionShell } from "./cockpit-section-shell";
import { CockpitUnavailableState } from "./cockpit-states";
import type { CockpitFinance } from "@/lib/operations/types";

/**
 * Centre d'Opérations — Finance widget (Phase 10.0C, Scope F).
 * The tenant-wide finance-request pipeline + invoice KPIs + reconciliation + open
 * collections, all from the composition layer. BINDING currency rule: amounts are
 * rendered PER CURRENCY (the pipeline's pendingAmounts[]), never summed across
 * currencies, never converted. NO Caisse/treasury balance is shown — none exists.
 */
function money(value: number, currency: string): string {
  return `${Math.round(value).toLocaleString("fr-FR")} ${currency}`;
}

export function FinancePipelineCard({ finance }: { finance: CockpitFinance }) {
  const req = finance.requests;
  const inv = finance.invoices;
  const recon = finance.reconciliation;

  return (
    <CockpitSectionShell title="Finance" action={{ href: "/finance", label: "Ouvrir Finance" }}>
      <div className="space-y-4">
        {/* Finance-request pipeline (tenant-wide) */}
        <div className="surface p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Circuit des demandes financières
          </p>
          {req ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard label="À examiner" value={req.pendingReview} tone="amber" href="/finance" />
                <StatCard label="Approuvées, non décaissées" value={req.approvedNotDisbursed} tone="navy" href="/finance" />
                <StatCard label="Justificatif à vérifier" value={req.evidenceToVerify} tone="teal" href="/finance" />
                <StatCard label="Justificatif attendu" value={req.evidenceMissing} tone="amber" href="/finance" />
                <StatCard label="À corriger" value={req.returned} tone="slate" href="/finance" />
              </div>
              {req.pendingAmounts.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Montants en attente :</span>
                  {/* PER CURRENCY — never summed across currencies. */}
                  {req.pendingAmounts.map((a) => (
                    <span
                      key={a.currency}
                      className="tabular rounded-full border border-slate-200 bg-sand-50/60 px-2.5 py-0.5 text-xs font-semibold text-navy-800"
                    >
                      {money(a.amount, a.currency)}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <CockpitUnavailableState message="Circuit des demandes financières non activé pour cet établissement." />
          )}
        </div>

        {/* Invoice KPIs + reconciliation + collections */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6">
          {inv && (
            <>
              <StatCard label="Encours à recouvrer" value={money(inv.outstanding, finance.currency)} tone="navy" href="/finance" />
              <StatCard label="Factures en retard" value={inv.overdueCount} tone="red" href="/finance" />
              <StatCard label="Factures émises" value={inv.issuedCount} tone="teal" href="/finance?status=ISSUED" />
              <StatCard label="Brouillons" value={inv.draftCount} tone="slate" href="/finance?status=DRAFT" />
            </>
          )}
          {/* « Revenu du mois » RETIRED (DEC-B44, 10.0D-4): it summed payments under a
              revenue label — the misleading D-0 trap. Monthly money is now the executive
              strip's authoritative, per-currency « Facturé (mois) » / « Encaissé (mois) ».
              (finance.revenueThisMonth stays in the view model, no longer rendered.) */}
          {finance.collectionsOpen != null && (
            <StatCard label="Recouvrements ouverts" value={finance.collectionsOpen} tone="amber" href="/collections" />
          )}
        </div>

        {recon && (recon.pending > 0 || recon.missingReference > 0 || recon.failedIntents > 0) && (
          <div className="surface flex flex-wrap items-center gap-x-4 gap-y-1 p-4 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rapprochement</span>
            <span className="text-slate-600">Paiements à vérifier : <b className="tabular text-navy-900">{recon.pending}</b></span>
            <span className="text-slate-600">Sans référence : <b className="tabular text-amber-700">{recon.missingReference}</b></span>
            <span className="text-slate-600">Intentions échouées : <b className="tabular text-red-700">{recon.failedIntents}</b></span>
            <Link href="/finance/reconciliation" className="ml-auto text-xs font-medium text-teal-700 hover:underline">
              Ouvrir le rapprochement →
            </Link>
          </div>
        )}
      </div>
    </CockpitSectionShell>
  );
}

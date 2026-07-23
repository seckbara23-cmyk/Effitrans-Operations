"use client";

/**
 * Finance execution panel (Phase 9.0E) — lives on the flag-gated process
 * inspector, so with the finance flag off nothing anywhere changes. Drives the
 * steps 20–26 seam: request intake, maker-checker review, explicit
 * disbursement, evidence attach/verify, billable conversion, and the financial
 * clearance ("feu vert financier"). Honest labels only: an approved request is
 * never shown as paid, a submitted proof is never shown as verified.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createFinanceRequest,
  reviewFinanceRequest,
  resubmitFinanceRequest,
  recordDisbursement,
  attachDisbursementEvidence,
  verifyDisbursementEvidence,
  convertRequestToCharge,
  clearFinance,
  type FinanceState,
} from "@/lib/finance/request-actions";
import {
  FINANCE_CATEGORIES,
  DISBURSEMENT_METHODS,
  REQUEST_STATUS_LABELS_FR,
  EVIDENCE_STATUS_LABELS_FR,
  CLEARANCE_MISSING_LABELS_FR,
} from "@/lib/finance/requests";

const ERROR_FR: Record<string, string> = {
  finance_disabled: "Le flux d'exécution Finance n'est pas activé.",
  forbidden: "Action non autorisée.",
  not_found: "Élément introuvable.",
  invalid_state: "Action impossible dans l'état actuel.",
  reason_required: "Une information obligatoire est manquante.",
  self_review_forbidden: "Le demandeur ne peut pas réviser sa propre demande.",
  self_verification_forbidden: "L'exécutant du décaissement ne peut pas vérifier son propre justificatif.",
  not_reimbursable: "Cette dépense n'est pas refacturable au client.",
  clearance_not_ready: "Le feu vert financier n'est pas encore possible.",
};
const frError = (code: string) => ERROR_FR[code] ?? "L'action a échoué. Réessayez.";

const STATUS_TONE: Record<string, string> = {
  REQUESTED: "bg-blue-50 text-blue-700 border-blue-200",
  APPROVED: "bg-amber-50 text-amber-700 border-amber-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  RETURNED: "bg-orange-50 text-orange-700 border-orange-200",
  DISBURSED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-slate-50 text-slate-500 border-slate-200",
};

const fmtAmount = (v: number, currency: string) =>
  `${new Intl.NumberFormat("fr-FR").format(v)} ${currency}`;

export function FinancePanel({
  fileId,
  state,
  canRequest,
  canReview,
  canDisburse,
  canAttach,
  canVerify,
  canBill,
  canClear,
}: {
  fileId: string;
  state: FinanceState;
  canRequest: boolean;
  canReview: boolean;
  canDisburse: boolean;
  canAttach: boolean;
  canVerify: boolean;
  canBill: boolean;
  canClear: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [category, setCategory] = useState("CUSTOMS_DUTY");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [disburseForms, setDisburseForms] = useState<Record<string, { amount: string; method: string; reference: string }>>({});
  const [evidencePick, setEvidencePick] = useState<Record<string, string>>({});
  const [deferInvoice, setDeferInvoice] = useState(false);
  const [deferReason, setDeferReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, successNotice: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const missing = (res as { missing?: string[] }).missing;
        const detail = missing?.length
          ? ` ${missing.map((m) => CLEARANCE_MISSING_LABELS_FR[m as keyof typeof CLEARANCE_MISSING_LABELS_FR] ?? m).join(" ")}`
          : "";
        setError(frError(String((res as { error?: string }).error ?? "generic")) + detail);
      } else {
        setNotice(successNotice);
        router.refresh();
      }
    });
  }

  const invoiceLabel =
    state.invoiceState === "issued" ? "Facture émise"
    : state.invoiceState === "validated" ? "Facture validée — non émise"
    : state.invoiceState === "draft" ? "Facture en brouillon"
    : "Aucune facture";

  return (
    <section className="rounded-lg border border-emerald-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Exécution Finance (demandes de fonds)</h2>
        <p className="text-xs text-slate-500">
          {invoiceLabel}
          {state.openFinanceBlockers > 0 && (
            <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
              {state.openFinanceBlockers} blocage(s) financier(s)
            </span>
          )}
        </p>
      </div>

      {/* Requests */}
      <ul className="mt-3 space-y-2">
        {state.requests.length === 0 && (
          <li className="text-xs text-slate-500">Aucune demande de fonds sur ce dossier.</li>
        )}
        {state.requests.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {r.categoryLabel} · {fmtAmount(r.amount, r.currency)}
                  {r.reimbursable && <span className="ml-1.5 rounded bg-teal-50 px-1 text-[10px] text-teal-700">refacturable</span>}
                  {r.billed && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] text-slate-600">refacturé</span>}
                </p>
                <p className="text-xs text-slate-600">{r.purpose} — bénéficiaire : {r.beneficiary}</p>
                <p className="text-[11px] text-slate-400">
                  Demandé par {r.requestedByName}
                  {r.reviewedByName && ` · revu par ${r.reviewedByName}`}
                  {r.disbursedByName && ` · décaissé par ${r.disbursedByName}`}
                  {r.disbursedAmount !== null && ` (${fmtAmount(r.disbursedAmount, r.currency)}${r.disbursementReference ? `, réf. ${r.disbursementReference}` : ""})`}
                </p>
                {r.reviewNote && <p className="text-[11px] text-orange-700">Note de revue : {r.reviewNote}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`}>
                  {REQUEST_STATUS_LABELS_FR[r.status]}
                </span>
                {r.status === "DISBURSED" && (
                  <span className="text-[10px] text-slate-500">{EVIDENCE_STATUS_LABELS_FR[r.evidenceStatus]}</span>
                )}
              </div>
            </div>

            {/* Review (step 21) */}
            {r.status === "REQUESTED" && canReview && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={reviewNotes[r.id] ?? ""}
                  onChange={(e) => setReviewNotes((m) => ({ ...m, [r.id]: e.target.value }))}
                  placeholder="Note de revue (obligatoire pour rejet / retour)"
                  className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
                />
                <button type="button" disabled={pending}
                  onClick={() => run(() => reviewFinanceRequest(fileId, r.id, { verdict: "APPROVED", note: reviewNotes[r.id] }), "Demande approuvée — le décaissement reste à exécuter.")}
                  className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                  Approuver
                </button>
                <button type="button" disabled={pending || !(reviewNotes[r.id] ?? "").trim()}
                  onClick={() => run(() => reviewFinanceRequest(fileId, r.id, { verdict: "RETURNED", note: reviewNotes[r.id] }), "Demande retournée pour correction.")}
                  className="rounded-lg border border-orange-300 px-2.5 py-1 text-xs font-medium text-orange-700 disabled:opacity-50">
                  Retourner
                </button>
                <button type="button" disabled={pending || !(reviewNotes[r.id] ?? "").trim()}
                  onClick={() => run(() => reviewFinanceRequest(fileId, r.id, { verdict: "REJECTED", note: reviewNotes[r.id] }), "Demande rejetée.")}
                  className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 disabled:opacity-50">
                  Rejeter
                </button>
              </div>
            )}

            {/* Resubmit (returned) */}
            {r.status === "RETURNED" && canRequest && (
              <button type="button" disabled={pending}
                onClick={() => run(() => resubmitFinanceRequest(fileId, r.id), "Demande resoumise à la revue Finance.")}
                className="mt-2 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50">
                Resoumettre après correction
              </button>
            )}

            {/* Disbursement (step 22) */}
            {r.status === "APPROVED" && canDisburse && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={disburseForms[r.id]?.amount ?? String(r.amount)}
                  onChange={(e) => setDisburseForms((m) => ({ ...m, [r.id]: { amount: e.target.value, method: m[r.id]?.method ?? "BANK_TRANSFER", reference: m[r.id]?.reference ?? "" } }))}
                  placeholder="Montant"
                  inputMode="decimal"
                  className="w-28 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
                />
                <select
                  aria-label="Méthode de paiement"
                  value={disburseForms[r.id]?.method ?? "BANK_TRANSFER"}
                  onChange={(e) => setDisburseForms((m) => ({ ...m, [r.id]: { amount: m[r.id]?.amount ?? String(r.amount), method: e.target.value, reference: m[r.id]?.reference ?? "" } }))}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
                >
                  {DISBURSEMENT_METHODS.map((mth) => <option key={mth} value={mth}>{mth}</option>)}
                </select>
                <input
                  value={disburseForms[r.id]?.reference ?? ""}
                  onChange={(e) => setDisburseForms((m) => ({ ...m, [r.id]: { amount: m[r.id]?.amount ?? String(r.amount), method: m[r.id]?.method ?? "BANK_TRANSFER", reference: e.target.value } }))}
                  placeholder="Référence"
                  className="w-32 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
                />
                <button type="button" disabled={pending || !(Number(disburseForms[r.id]?.amount ?? r.amount) > 0)}
                  onClick={() =>
                    run(
                      () => recordDisbursement(fileId, r.id, {
                        amount: Number(disburseForms[r.id]?.amount ?? r.amount),
                        method: disburseForms[r.id]?.method ?? "BANK_TRANSFER",
                        reference: disburseForms[r.id]?.reference,
                      }),
                      "Décaissement enregistré — joignez le justificatif.",
                    )
                  }
                  className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                  Enregistrer le décaissement
                </button>
              </div>
            )}

            {/* Evidence (step 24) */}
            {r.status === "DISBURSED" && (r.evidenceStatus === "NONE" || r.evidenceStatus === "REJECTED") && canAttach && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  aria-label="Choisir le justificatif"
                  value={evidencePick[r.id] ?? ""}
                  onChange={(e) => setEvidencePick((m) => ({ ...m, [r.id]: e.target.value }))}
                  className="min-w-[200px] rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">— Choisir un document du dossier —</option>
                  {state.evidenceDocuments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                <button type="button" disabled={pending || !evidencePick[r.id]}
                  onClick={() => run(() => attachDisbursementEvidence(fileId, r.id, evidencePick[r.id]), "Justificatif transmis — vérification en attente.")}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50">
                  Joindre le justificatif
                </button>
                {state.evidenceDocuments.length === 0 && (
                  <p className="text-[11px] text-amber-700">Téléversez d&apos;abord le reçu dans les documents du dossier.</p>
                )}
              </div>
            )}
            {r.status === "DISBURSED" && r.evidenceStatus === "SUBMITTED" && canVerify && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={reviewNotes[`ev-${r.id}`] ?? ""}
                  onChange={(e) => setReviewNotes((m) => ({ ...m, [`ev-${r.id}`]: e.target.value }))}
                  placeholder="Note (obligatoire pour rejet)"
                  className="min-w-[180px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
                />
                <button type="button" disabled={pending}
                  onClick={() => run(() => verifyDisbursementEvidence(fileId, r.id, { verdict: "VERIFIED", note: reviewNotes[`ev-${r.id}`] }), "Justificatif vérifié.")}
                  className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                  Vérifier
                </button>
                <button type="button" disabled={pending || !(reviewNotes[`ev-${r.id}`] ?? "").trim()}
                  onClick={() => run(() => verifyDisbursementEvidence(fileId, r.id, { verdict: "REJECTED", note: reviewNotes[`ev-${r.id}`] }), "Justificatif rejeté — un nouveau justificatif est attendu.")}
                  className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 disabled:opacity-50">
                  Rejeter le justificatif
                </button>
              </div>
            )}

            {/* Billable conversion (step 25) */}
            {r.status === "DISBURSED" && r.reimbursable && !r.billed && canBill && (
              <button type="button" disabled={pending}
                onClick={() => run(() => convertRequestToCharge(fileId, r.id), "Dépense convertie en frais refacturable — la chaîne de facturation existante prend le relais.")}
                className="mt-2 rounded-lg border border-teal-300 px-2.5 py-1 text-xs font-medium text-teal-700 disabled:opacity-50">
                Refacturer au client
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* New request (step 20) */}
      {canRequest && (
        <div className="mt-3">
          <button type="button" disabled={pending}
            onClick={() => setShowRequestForm((v) => !v)}
            className="min-h-[32px] rounded-lg border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
            Nouvelle demande de fonds
          </button>
          {showRequestForm && (
            <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap gap-2">
                <select aria-label="Catégorie" value={category} onChange={(e) => setCategory(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none">
                  {FINANCE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.labelFr}</option>)}
                </select>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Montant (XOF)" inputMode="decimal"
                  className="w-32 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 focus:outline-none" />
              </div>
              <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Objet de la dépense (obligatoire)"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 focus:outline-none" />
              <input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="Bénéficiaire / autorité (obligatoire)"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 focus:outline-none" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowRequestForm(false)} className="rounded-lg px-3 py-1 text-xs text-slate-500 hover:bg-slate-100">Annuler</button>
                <button type="button"
                  disabled={pending || !(Number(amount) > 0) || !purpose.trim() || !beneficiary.trim()}
                  onClick={() =>
                    run(
                      () => createFinanceRequest(fileId, { category, amount: Number(amount), purpose: purpose.trim(), beneficiary: beneficiary.trim() }),
                      "Demande de fonds transmise à la Finance.",
                    )
                  }
                  className="rounded-lg bg-emerald-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                  Soumettre
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Financial clearance (step 26) */}
      <div className="mt-3 rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-medium text-slate-600">Feu vert financier</p>
        {state.clearance.ready ? (
          <p className="mt-1 text-xs text-emerald-700">Toutes les conditions financières sont réunies.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {state.clearance.missing.map((m) => (
              <li key={m} className="text-xs text-amber-700">⚠ {CLEARANCE_MISSING_LABELS_FR[m]}</li>
            ))}
          </ul>
        )}
        {canClear && (
          <div className="mt-2 space-y-2">
            {state.invoiceState === "none" && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={deferInvoice} onChange={(e) => setDeferInvoice(e.target.checked)} />
                Report explicite de la facturation (motif requis)
              </label>
            )}
            {deferInvoice && (
              <input value={deferReason} onChange={(e) => setDeferReason(e.target.value)} placeholder="Motif du report de facturation"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 focus:outline-none" />
            )}
            <button type="button"
              disabled={pending || (deferInvoice && !deferReason.trim())}
              onClick={() =>
                run(
                  () => clearFinance(fileId, deferInvoice ? { invoiceIntentionallyDeferred: true, deferralReason: deferReason.trim() } : undefined),
                  "Feu vert financier accordé — la suite du circuit est notifiée.",
                )
              }
              className="min-h-[32px] rounded-lg bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50">
              Accorder le feu vert financier
            </button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-xs text-emerald-700">{notice}</p>}
    </section>
  );
}

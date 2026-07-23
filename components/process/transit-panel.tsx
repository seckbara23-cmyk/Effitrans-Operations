"use client";

/**
 * Transit execution panel (Phase 9.0D) — lives on the flag-gated process
 * inspector, so with the transit flag off nothing anywhere changes. Drives the
 * Transit slice: reception, the T1–T10 progress read-model, declarant
 * assignment (names/roles — never a UUID), the finance payment gate, BAE
 * capture, field dispatch, and Customs-observation blockers. Every button maps
 * to one existing, individually-audited server action.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  receiveDossierAtTransit,
  assignTransitStep,
  requestPaymentGateDecision,
  finalizePaymentGateDecision,
  recordBae,
  dispatchToField,
  type TransitState,
  type TransitAssignee,
} from "@/lib/process/engine/transit-actions";
import { openProcessBlocker, resolveProcessBlocker } from "@/lib/process/engine/structures-actions";

const ERROR_FR: Record<string, string> = {
  engine_disabled: "Le flux d'exécution Transit n'est pas activé.",
  forbidden: "Action non autorisée.",
  not_found: "Élément introuvable.",
  handoff_not_open: "Aucun transfert en attente de réception.",
  invalid_state: "Action impossible dans l'état actuel du dossier.",
  reason_required: "Une information obligatoire est manquante.",
  unknown_step: "Étape inconnue.",
};
const frError = (code: string) => ERROR_FR[code] ?? "L'action a échoué. Réessayez.";

const STATUS_TONE: Record<string, string> = {
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  active: "bg-blue-50 text-blue-700 border-blue-200",
  blocked: "bg-red-50 text-red-700 border-red-200",
  pending: "bg-slate-50 text-slate-500 border-slate-200",
};
const STATUS_LABEL: Record<string, string> = {
  done: "Terminé",
  active: "En cours",
  blocked: "Bloqué",
  pending: "En attente",
};

const CUSTOMER_STAGE_FR: Record<string, string> = {
  documents_verification: "Documents en vérification",
  customer_action_required: "Action client requise",
  declaration_preparation: "Déclaration en préparation",
  declaration_filed: "Déclaration déposée",
  customs_formalities: "Formalités douanières en cours",
  authorization_obtained: "Autorisation obtenue",
  pickup_preparation: "Enlèvement en préparation",
};

export function TransitPanel({
  fileId,
  state,
  eligibleDeclarants,
  canReceive,
  canAssign,
  canRequestDecision,
  canApproveDecision,
  canRecordBae,
  canDispatch,
  canManageBlockers,
}: {
  fileId: string;
  state: TransitState;
  eligibleDeclarants: TransitAssignee[];
  canReceive: boolean;
  canAssign: boolean;
  canRequestDecision: boolean;
  canApproveDecision: boolean;
  canRecordBae: boolean;
  canDispatch: boolean;
  canManageBlockers: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [declarantId, setDeclarantId] = useState("");
  const [baeRef, setBaeRef] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [overrideTeam, setOverrideTeam] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [obsTitle, setObsTitle] = useState("");
  const [obsCustomerMessage, setObsCustomerMessage] = useState("");
  const [showObsForm, setShowObsForm] = useState(false);

  function run(fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, successNotice: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(frError(String((res as { error?: string }).error ?? "generic")));
      else {
        setNotice(successNotice);
        router.refresh();
      }
    });
  }

  const gate = state.paymentGate;
  const gatePending = gate?.status === "PENDING";

  return (
    <section className="rounded-lg border border-indigo-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Exécution Transit (T1–T10)</h2>
        {state.owner && (
          <p className="text-xs text-slate-500">
            Responsable opérationnel : <strong className="text-slate-700">{state.owner.name}</strong>
            {state.owner.roleLabel ? ` · ${state.owner.roleLabel}` : ""}
          </p>
        )}
      </div>

      {/* Reception */}
      {state.reception.pending && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
          <div>
            <p className="text-sm font-medium text-slate-900">Dossier transmis par les Opérations</p>
            <p className="text-xs text-slate-600">En attente de réception par le Transit.</p>
          </div>
          {canReceive && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => receiveDossierAtTransit(fileId), "Dossier réceptionné.")}
              className="min-h-[36px] rounded-lg bg-indigo-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
            >
              Réceptionner le dossier
            </button>
          )}
        </div>
      )}

      {/* T1–T10 progress */}
      <ol className="mt-3 space-y-1.5">
        {state.stages.map((s) => (
          <li key={s.key} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-1.5 last:border-0">
            <div>
              <p className="text-sm text-slate-800">
                <span className="font-medium text-slate-500">{s.key}.</span> {s.labelFr}
              </p>
              <p className="text-[11px] text-slate-400">
                {s.responsibleFr}
                {s.customerStage && ` · le client voit « ${CUSTOMER_STAGE_FR[s.customerStage]} »`}
              </p>
            </div>
            <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[s.status]}`}>
              {STATUS_LABEL[s.status]}
            </span>
          </li>
        ))}
      </ol>

      {/* Declarant assignment */}
      <div className="mt-4 rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-medium text-slate-600">Déclarant en douane</p>
        {state.declarant ? (
          <p className="mt-1 text-sm text-slate-800">
            <strong>{state.declarant.name}</strong>
            {state.declarant.roleLabel ? <span className="text-xs text-slate-500"> · {state.declarant.roleLabel}</span> : null}
          </p>
        ) : canAssign ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              aria-label="Choisir le déclarant"
              value={declarantId}
              onChange={(e) => setDeclarantId(e.target.value)}
              disabled={pending}
              className="min-w-[220px] rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">— Choisir un déclarant Transit —</option>
              {eligibleDeclarants.map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.roleLabel ? ` — ${d.roleLabel}` : ""}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !declarantId}
              onClick={() => run(() => assignTransitStep(fileId, "customs_preparation", declarantId), "Déclarant affecté.")}
              className="min-h-[36px] rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              Affecter
            </button>
            {eligibleDeclarants.length === 0 && <p className="text-xs text-amber-700">Aucun déclarant Transit actif.</p>}
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">Non affecté.</p>
        )}
      </div>

      {/* Finance payment gate */}
      <div className="mt-3 rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-medium text-slate-600">Décision Finance — continuer avant paiement</p>
        {gate ? (
          <p className="mt-1 text-sm text-slate-700">
            Statut : <strong>{gate.status === "FINALIZED" ? "Finalisée" : "En attente"}</strong>
            {gate.outcome && ` · issue : ${gate.outcome}`}
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">Aucune décision demandée.</p>
        )}
        {!gate && canRequestDecision && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder="Motif de la demande (obligatoire)"
              className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={pending || !decisionReason.trim()}
              onClick={() => run(() => requestPaymentGateDecision(fileId, decisionReason.trim()), "Décision demandée — Finance notifiée.")}
              className="min-h-[32px] rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Demander la décision
            </button>
          </div>
        )}
        {gatePending && canApproveDecision && (
          <div className="mt-2 flex flex-wrap gap-2">
            {["BLOCK_UNTIL_PAYMENT", "CONTINUE_PROVISIONALLY", "CONTINUE_WITH_APPROVAL"].map((o) => (
              <button
                key={o}
                type="button"
                disabled={pending}
                onClick={() => run(() => finalizePaymentGateDecision(fileId, gate!.decisionId!, o), "Décision finalisée.")}
                className="min-h-[32px] rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {o === "BLOCK_UNTIL_PAYMENT" ? "Bloquer jusqu'au paiement" : o === "CONTINUE_PROVISIONALLY" ? "Continuer provisoirement" : "Continuer avec approbation"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* BAE capture */}
      <div className="mt-3 rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-medium text-slate-600">BAE — Bon À Enlever</p>
        {state.bae.obtained ? (
          <p className="mt-1 text-sm text-emerald-700">
            Obtenu · référence <strong>{state.bae.reference}</strong> — le client voit « Autorisation obtenue ».
          </p>
        ) : canRecordBae ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={baeRef}
              onChange={(e) => setBaeRef(e.target.value)}
              placeholder="Référence BAE"
              className="min-w-[180px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={pending || !baeRef.trim()}
              onClick={() => run(() => recordBae(fileId, baeRef.trim()), "BAE enregistré — « Autorisation obtenue » publiée au client.")}
              className="min-h-[36px] rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Enregistrer le BAE
            </button>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">En attente.</p>
        )}
      </div>

      {/* Field dispatch */}
      <div className="mt-3 rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-medium text-slate-600">Dispatch terrain (AIBD / Maritime)</p>
        {state.dispatch.teamCode ? (
          <p className="mt-1 text-sm text-slate-800">Équipe : <strong>{state.dispatch.teamCode}</strong></p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            {state.dispatch.deterministic
              ? `Équipe suggérée d'après le mode : ${state.dispatch.suggestion}.`
              : "Mode ambigu (route / manutention / multimodal) — choix explicite requis."}
          </p>
        )}
        {!state.dispatch.teamCode && canDispatch && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {state.dispatch.deterministic ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => dispatchToField(fileId), `Dossier dispatché à ${state.dispatch.suggestion}.`)}
                className="min-h-[36px] rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
              >
                Dispatcher vers {state.dispatch.suggestion}
              </button>
            ) : (
              <>
                <select
                  aria-label="Choisir l'équipe"
                  value={overrideTeam}
                  onChange={(e) => setOverrideTeam(e.target.value)}
                  disabled={pending}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">— Équipe —</option>
                  <option value="AIBD">AIBD</option>
                  <option value="MARITIME">Maritime</option>
                </select>
                <input
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Motif du choix"
                  className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={pending || !overrideTeam || !overrideReason.trim()}
                  onClick={() => run(() => dispatchToField(fileId, { teamCode: overrideTeam, reason: overrideReason.trim() }), `Dossier dispatché à ${overrideTeam}.`)}
                  className="min-h-[36px] rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
                >
                  Dispatcher
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Blockers / customs observations */}
      {state.openBlockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 p-3">
          <p className="text-xs font-semibold text-red-700">Points bloquants / observations</p>
          <ul className="mt-1 space-y-1.5">
            {state.openBlockers.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-xs text-slate-700">
                <span>
                  {b.title} <span className="text-slate-400">({b.category})</span>
                  {b.customerVisible && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">visible client</span>}
                </span>
                {canManageBlockers && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => resolveProcessBlocker(fileId, b.id, "Résolu depuis le panneau Transit."), "Point bloquant résolu.")}
                    className="shrink-0 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Résoudre
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManageBlockers && (
        <div className="mt-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowObsForm((v) => !v)}
            className="min-h-[32px] rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Signaler une observation douane
          </button>
          {showObsForm && (
            <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label htmlFor="obs-title" className="block text-xs font-medium text-slate-600">Observation interne (jamais visible du client)</label>
              <input
                id="obs-title"
                value={obsTitle}
                onChange={(e) => setObsTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                placeholder="Ex. : circuit rouge — visite physique demandée"
              />
              <label htmlFor="obs-customer" className="block text-xs font-medium text-slate-600">Message client (optionnel — affiché uniquement si renseigné)</label>
              <input
                id="obs-customer"
                value={obsCustomerMessage}
                onChange={(e) => setObsCustomerMessage(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                placeholder="Ex. : Un contrôle douanier est en cours sur votre dossier."
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowObsForm(false)} className="rounded-lg px-3 py-1 text-xs text-slate-500 hover:bg-slate-100">Annuler</button>
                <button
                  type="button"
                  disabled={pending || !obsTitle.trim()}
                  onClick={() =>
                    run(
                      () =>
                        openProcessBlocker(fileId, {
                          category: "CUSTOMS_OBSERVATION",
                          title: obsTitle.trim(),
                          stepKey: "customs_followup",
                          customerVisible: Boolean(obsCustomerMessage.trim()),
                          customerMessage: obsCustomerMessage.trim() || undefined,
                        }),
                      "Observation enregistrée.",
                    )
                  }
                  className="rounded-lg bg-red-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-xs text-emerald-700">{notice}</p>}
    </section>
  );
}

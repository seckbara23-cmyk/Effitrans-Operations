"use client";

/**
 * « Démarrer » / « Terminer » on the dossier's own official-process page.
 * ---------------------------------------------------------------------------
 * NOT a second engine. These are the SAME two server actions the department
 * queue calls — `queueStartStep` → `activateStep`, `queueSubmitStep` →
 * `submitStep` — and the eligibility behind them is the SAME derivation
 * (`evaluateStepAction`), computed server-side and passed in. This component
 * decides nothing; it renders a verdict.
 *
 * Why it exists: an Account Manager opened EFT-IMP-2026-00010, found step 3
 * AVAILABLE on the official-process page, and had no way to perform it. The
 * capability was there and fully governed — it simply lived only in
 * `/queues/account_management`, which nothing on the dossier pointed to. The
 * work moved to the operator instead of the operator hunting for the work.
 *
 * The queue remains a valid work-management surface. What changed is that the
 * dossier page is now an execution surface for the same workflow, on the same
 * rules, with the same server refusing the same things.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { queueStartStep, queueSubmitStep } from "@/lib/process/queues/actions";
import type { StepEligibility } from "@/lib/process/step-eligibility";

/**
 * Every code the two engine actions can return. A refusal an operator cannot
 * read is the defect UAT-00009 was about; a contract test derives this set from
 * the engine's own error union.
 */
const ERROR_FR: Record<string, string> = {
  engine_disabled: "Moteur de processus désactivé.",
  forbidden: "Action non autorisée.",
  not_found: "Dossier ou étape introuvable.",
  unknown_step: "Étape inconnue.",
  step_assigned_to_other: "Cette étape est affectée à une autre personne.",
  not_authorized_assigner: "Cette affectation relève du Chef de Transit.",
  transit_custody_required: "Le Transit doit d'abord réceptionner le dossier et terminer sa réception.",
  handoff_not_sent: "Le dossier doit d'abord être formellement transmis au service suivant.",
  not_authorized_sender: "Vous n'êtes pas habilité à effectuer cette transmission.",
  invalid_state: "L'étape a changé d'état. Rafraîchissez la page.",
  prerequisites_unmet: "Prérequis non satisfaits.",
  evidence_missing: "Preuves requises manquantes.",
  evidence_unauthorized:
    "Vous n'avez pas accès aux preuves exigées par cette étape. "
    + "Elle doit être clôturée par une personne habilitée à les consulter.",
  gate_blocked: "Porte de convergence bloquée.",
  self_validation_forbidden: "Vous ne pouvez pas valider votre propre travail.",
  override_not_allowed: "Dérogation non autorisée.",
  reason_required: "Un motif est obligatoire.",
  handoff_not_open: "Ce transfert n'est plus en attente.",
  not_eligible_receiver: "Ce transfert ne vous est pas destiné.",
  from_step_incomplete: "L'étape d'origine du transfert n'est pas terminée.",
  handoff_reception_required: "Réceptionnez d'abord le dossier : cette étape vous a été transmise.",
};

/** Why an artefact does not count yet — the evaluator's own vocabulary. */
const EVIDENCE_STATUS_FR: Record<string, string> = {
  missing: "manquant",
  invalid: "rejeté ou expiré",
  pending_review: "en attente de validation",
};

type MissingEvidence = { key: string; labelFr: string; status: string };

export function StepActions({
  fileId,
  queueKey,
  stepKey,
  eligibility,
  assigneeLabel,
}: {
  fileId: string;
  /** The department queue this step belongs to — the action's revalidation scope. */
  queueKey: string;
  stepKey: string;
  /** Server-computed, from the SAME function the queue uses. */
  eligibility: StepEligibility;
  /** Who holds the step, when somebody does. Claim state must be legible. */
  assigneeLabel: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingEvidence[]>([]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; missing?: MissingEvidence[] }>) => {
    setError(null);
    setMissing([]);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        router.refresh();
        return;
      }
      setError(ERROR_FR[r.error ?? ""] ?? "Action refusée.");
      setMissing(r.missing ?? []);
    });
  };

  const btn = "rounded border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {eligibility.canStart && (
          <button
            type="button"
            className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            disabled={pending}
            onClick={() => run(() => queueStartStep(queueKey, fileId, stepKey))}
          >
            Démarrer
          </button>
        )}

        {eligibility.canSubmit && (
          <button
            type="button"
            className={`${btn} border-navy-300 bg-navy-50 text-navy-800 hover:bg-navy-100`}
            disabled={pending}
            onClick={() => run(() => queueSubmitStep(queueKey, fileId, stepKey))}
          >
            Terminer
          </button>
        )}
      </div>

      {/* Claim state, so « no button » is never mistaken for « broken ». */}
      {assigneeLabel && (
        <p className="text-[11px] text-slate-500">En cours : {assigneeLabel}</p>
      )}
      {!eligibility.canStart && !eligibility.canSubmit && eligibility.reasonFr && (
        <p className="max-w-[18rem] text-right text-[11px] text-slate-500">{eligibility.reasonFr}</p>
      )}

      {error && <p className="max-w-[18rem] text-right text-[11px] text-red-600" role="alert">{error}</p>}
      {missing.length > 0 && (
        <ul className="max-w-[18rem] space-y-0.5 text-right text-[11px] text-red-600">
          {missing.map((m) => (
            <li key={m.key}>
              {m.labelFr} — {EVIDENCE_STATUS_FR[m.status] ?? m.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

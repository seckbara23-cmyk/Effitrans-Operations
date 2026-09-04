"use client";
/**
 * Queue row actions (Phase 5.0C). Client component — but it mutates NOTHING.
 * ---------------------------------------------------------------------------
 * Every button calls a server action in lib/process/queues/actions.ts, which
 * delegates to the Phase 5.0B engine. The engine re-authenticates, re-checks the
 * tenant and the permission, and enforces the state machine, the gates and the
 * maker-checker rule. Nothing here is trusted.
 *
 * Rejection ALWAYS collects a reason before it can be sent: the engine refuses a
 * blank one, and asking here just avoids a pointless round-trip.
 */
import { useState, useTransition } from "react";
import type { QueueItem } from "@/lib/process/queues/service";
import type { QueueDef } from "@/lib/process/queues/registry";
import {
  queueApproveStep,
  queueReceiveHandoff,
  queueRejectStep,
  queueStartStep,
  queueSubmitStep,
} from "@/lib/process/queues/actions";
import type { MissingEvidence } from "@/lib/process/engine/types";

const ERROR_FR: Record<string, string> = {
  engine_disabled: "Moteur de processus désactivé.",
  forbidden: "Action non autorisée.",
  not_found: "Dossier ou étape introuvable.",
  invalid_state: "L'étape a déjà changé d'état. Rafraîchissez la file.",
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
  cross_tenant: "Action non autorisée.",
  unknown_step: "Étape inconnue.",
  handoff_not_sent: "Le dossier doit d'abord être formellement transmis au service suivant.",
  not_authorized_sender: "Vous n'êtes pas habilité à effectuer cette transmission.",
  already_initialized: "Processus déjà initialisé.",
  // C-4 — work arrived by handoff and has not been accepted yet.
  handoff_reception_required: "Réceptionnez d'abord le dossier : cette étape vous a été transmise.",
  not_eligible_receiver: "Ce transfert ne vous est pas destiné.",
  // C-2 — a handoff may not outrun its own from-step.
  from_step_incomplete: "L'étape d'origine du transfert n'est pas terminée.",
};

/** Why a required artefact does not count yet — the evaluator's own vocabulary. */
const EVIDENCE_STATUS_FR: Record<string, string> = {
  missing: "manquant",
  invalid: "rejeté ou expiré",
  pending_review: "en attente de validation",
};

const btn =
  "rounded border px-2 py-1 text-xs font-medium transition disabled:opacity-50";

export function QueueRowActions({ item, queue }: { item: QueueItem; queue: QueueDef }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingEvidence[]>([]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; missing?: MissingEvidence[] }>) => {
    setError(null);
    setMissing([]);
    start(async () => {
      const r = await fn();
      if (r.ok) return;
      setError(ERROR_FR[r.error ?? ""] ?? "Action refusée.");
      // The engine now says WHICH artefacts are outstanding. Names come from the
      // document catalogue (type_code), never from an uploaded filename.
      setMissing(r.missing ?? []);
    });
  };

  const rejectWithReason = (fn: (reason: string) => Promise<{ ok: boolean; error?: string }>) => {
    const reason = window.prompt("Motif du rejet (obligatoire) :")?.trim();
    if (!reason) {
      setError("Un motif est obligatoire.");
      return;
    }
    run(() => fn(reason));
  };

  // A-2. TWO conditions, not one. `queue.actions` says the QUEUE offers this
  // kind of action; `item.eligibility` says whether THIS caller may perform it
  // on THIS step, resolved from the step's own registry permission exactly as
  // the engine resolves it. Offering on queue membership alone is what showed
  // « Démarrer » to a Chef de Transit and then answered « Action non autorisée ».
  //
  // The second condition now comes from the SHARED derivation
  // (`evaluateStepAction`) that the dossier's official-process page also reads
  // — UAT-WF-STEP3-001. It used to live here as its own expressions, and two
  // execution surfaces cannot be kept honest by two copies of one rule.
  //
  // ADVISORY ONLY. Every server action re-checks independently; hiding a button
  // is a courtesy, never a boundary.
  const offers = (a: string) => queue.actions.includes(a as never);
  const el = item.eligibility;

  // Work that arrived by handoff cannot be started until it is RECEIVED. The
  // authority is the OPEN HANDOFF itself, not the queue's display flag: a queue
  // that declares no reception step still must not offer work the engine will
  // refuse with `handoff_reception_required`.
  const awaitingReception = el.awaitingReception;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {awaitingReception && queue.requiresReception && offers("receive_handoff") && item.callerMayReceive && (
          <button
            className={`${btn} border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100`}
            disabled={pending}
            onClick={() => run(() => queueReceiveHandoff(queue.key, item.fileId, item.handoffId!))}
          >
            Réceptionner
          </button>
        )}

        {offers("start") && el.canStart && (
          <button
            className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            disabled={pending}
            onClick={() => run(() => queueStartStep(queue.key, item.fileId, item.stepKey))}
          >
            Démarrer
          </button>
        )}

        {offers("submit") && el.canSubmit && (
          <button
            className={`${btn} border-navy-300 bg-navy-50 text-navy-800 hover:bg-navy-100`}
            disabled={pending}
            title={undefined}
            onClick={() => run(() => queueSubmitStep(queue.key, item.fileId, item.stepKey))}
          >
            Soumettre
          </button>
        )}

        {/* The CHECKER half. The engine still refuses if this user is the maker. */}
        {item.state === "SUBMITTED" && (offers("approve") && el.mayAct) && (
          <>
            <button
              className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
              disabled={pending}
              onClick={() => run(() => queueApproveStep(queue.key, item.fileId, item.stepKey))}
            >
              Valider
            </button>
            <button
              className={`${btn} border-red-300 bg-red-50 text-red-800 hover:bg-red-100`}
              disabled={pending}
              onClick={() =>
                rejectWithReason((reason) => queueRejectStep(queue.key, item.fileId, item.stepKey, reason))
              }
            >
              Rejeter
            </button>
          </>
        )}

        <a
          href={`/files/${item.fileId}/process`}
          className={`${btn} border-slate-200 bg-white text-slate-500 hover:bg-slate-50`}
        >
          Processus
        </a>
      </div>

      {error && <p className="max-w-[16rem] text-right text-[11px] text-red-600">{error}</p>}
      {missing.length > 0 && (
        <ul className="max-w-[16rem] space-y-0.5 text-right text-[11px] text-red-600">
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

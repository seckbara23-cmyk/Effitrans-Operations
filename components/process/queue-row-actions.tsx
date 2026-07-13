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

const ERROR_FR: Record<string, string> = {
  engine_disabled: "Moteur de processus désactivé.",
  forbidden: "Action non autorisée.",
  not_found: "Dossier ou étape introuvable.",
  invalid_state: "L'étape a déjà changé d'état. Rafraîchissez la file.",
  prerequisites_unmet: "Prérequis non satisfaits.",
  evidence_missing: "Preuves requises manquantes.",
  gate_blocked: "Porte de convergence bloquée.",
  self_validation_forbidden: "Vous ne pouvez pas valider votre propre travail.",
  override_not_allowed: "Dérogation non autorisée.",
  reason_required: "Un motif est obligatoire.",
  handoff_not_open: "Ce transfert n'est plus en attente.",
  cross_tenant: "Action non autorisée.",
  unknown_step: "Étape inconnue.",
  already_initialized: "Processus déjà initialisé.",
};

const btn =
  "rounded border px-2 py-1 text-xs font-medium transition disabled:opacity-50";

export function QueueRowActions({ item, queue }: { item: QueueItem; queue: QueueDef }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(ERROR_FR[r.error ?? ""] ?? "Action refusée.");
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

  const can = (a: string) => queue.actions.includes(a as never);

  // Work that arrived by handoff cannot be started until it is RECEIVED.
  const awaitingReception = queue.requiresReception && !item.received && item.handoffId !== null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {awaitingReception && can("receive_handoff") && (
          <button
            className={`${btn} border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100`}
            disabled={pending}
            onClick={() => run(() => queueReceiveHandoff(queue.key, item.fileId, item.handoffId!))}
          >
            Réceptionner
          </button>
        )}

        {!awaitingReception && item.state === "AVAILABLE" && can("start") && (
          <button
            className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            disabled={pending}
            onClick={() => run(() => queueStartStep(queue.key, item.fileId, item.stepKey))}
          >
            Démarrer
          </button>
        )}

        {item.state === "ACTIVE" && can("submit") && (
          <button
            className={`${btn} border-navy-300 bg-navy-50 text-navy-800 hover:bg-navy-100`}
            disabled={pending || item.blockerSummary !== null}
            title={item.blockerSummary ?? undefined}
            onClick={() => run(() => queueSubmitStep(queue.key, item.fileId, item.stepKey))}
          >
            Soumettre
          </button>
        )}

        {/* The CHECKER half. The engine still refuses if this user is the maker. */}
        {item.state === "SUBMITTED" && can("approve") && (
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
    </div>
  );
}

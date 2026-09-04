"use client";

/**
 * « Transmettre au Transit » on the MAIN dossier page.
 * ---------------------------------------------------------------------------
 * DISCOVERY, NOT A SECOND TRANSITION. This calls the identical server action the
 * « Processus officiel Effitrans » screen calls — `handDossierToTransit` — which
 * remains the one authoritative Operations→Transit transition: same
 * `process:handoff:send` guard, same intake-blocker refusal, same idempotent
 * `sendHandoff("am_dossier_opening" → "coordinator_reception")`, same audit and
 * notifications. Nothing here decides anything; the server does.
 *
 * The reason it exists: the transition was reachable only from the process
 * screen, so operators working in the dossier had no way to hand the file over
 * from where they actually were — the same reachability defect class as the
 * intake surface (UAT-15c) and provider editing (UAT-17).
 *
 * Three states, and only three:
 *   sent      → « Dossier transmis au Transit — réception à confirmer », NO action
 *   blocked   → the unmet prerequisites, named, NO action
 *   ready     → the button
 * Client ownership (Responsable client) is never touched: this is a DEPARTMENTAL
 * handoff, and the commercial owner panel above it is the only thing that moves
 * that seat.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { handDossierToTransit } from "@/lib/process/engine/intake-actions";
import { HandoffPrerequisites } from "@/components/process/handoff-prerequisites";
import type { HandoffPrerequisite, ActionableStep } from "@/lib/process/intake";

/**
 * Every code `handDossierToTransit` can actually return. It previously carried
 * two codes the action never emits (`feature_disabled`, `cross_tenant_forbidden`)
 * and lacked the two it does emit when a from-step is unfinished — so the real
 * refusal fell through to a generic sentence. A contract test now derives this
 * set from the action's source.
 */
const ERROR_FR: Record<string, string> = {
  engine_disabled: "Moteur de processus désactivé.",
  forbidden: "Vous n'avez pas l'autorisation de transmettre ce dossier.",
  not_found: "Dossier introuvable ou processus non ouvert.",
  blocked_by_intake_blockers: "Transmission suspendue : un point bloquant est ouvert.",
  am_opening_incomplete: "Transmission impossible : l'étape d'ouverture et de préparation du dossier n'est pas terminée.",
  from_step_incomplete: "Transmission impossible : l'étape d'origine du transfert n'est pas terminée.",
  unknown_step: "Étape inconnue.",
  handoff_not_sent: "Le dossier doit d'abord être formellement transmis au service suivant.",
  not_authorized_sender: "Vous n'êtes pas habilité à effectuer cette transmission.",
  invalid_state: "L'état du dossier a changé. Rafraîchissez la page.",
};

export type TransitHandoffPrereq = HandoffPrerequisite;

export function TransitHandoff({
  fileId,
  handoffSent,
  canSend,
  prerequisites,
  firstActionable = null,
}: {
  fileId: string;
  handoffSent: boolean;
  canSend: boolean;
  /** Unmet prerequisites, already resolved server-side. Empty ⇒ transmissible. */
  prerequisites: TransitHandoffPrereq[];
  /** Registry-derived step to complete first; null when not derivable. */
  firstActionable?: ActionableStep | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ unmet: HandoffPrerequisite[]; firstActionable: ActionableStep | null } | null>(null);

  // TRANSMITTED — terminal for this surface. The action is not merely disabled,
  // it is absent: a dossier already handed over must never offer to hand over.
  if (handoffSent) {
    return (
      <section className="surface border-teal-200 bg-teal-50/60 p-4" aria-label="Transmission au Transit">
        <p className="text-sm font-medium text-navy-900">
          Dossier transmis au Transit — réception à confirmer
        </p>
        <p className="mt-0.5 text-xs text-slate-600">
          Le Transit doit « Réceptionner le dossier » avant de commencer son exécution.
        </p>
      </section>
    );
  }

  if (!canSend) return null;

  const blocked = prerequisites.length > 0;

  return (
    <section className="surface p-4" aria-label="Transmission au Transit">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-navy-900">Transmission au Transit</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Remise officielle du dossier des Opérations au Transit. Le responsable client reste inchangé.
          </p>
        </div>
        {!blocked && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setRefusal(null);
              startTransition(async () => {
                const res = await handDossierToTransit(fileId);
                if (res.ok) { router.refresh(); return; }
                // The server's own reasons win: same evaluator, same words.
                if (res.unmet && res.unmet.length > 0) {
                  setRefusal({ unmet: res.unmet, firstActionable: res.firstActionable ?? null });
                } else {
                  setError(ERROR_FR[String(res.error)] ?? "Transmission impossible.");
                }
              });
            }}
            className="min-h-[36px] rounded-lg bg-navy-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            Transmettre au Transit
          </button>
        )}
      </div>

      {blocked && <HandoffPrerequisites unmet={prerequisites} firstActionable={firstActionable} />}

      {refusal && <HandoffPrerequisites unmet={refusal.unmet} firstActionable={refusal.firstActionable} />}

      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

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

const ERROR_FR: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation de transmettre ce dossier.",
  not_found: "Dossier introuvable ou processus non ouvert.",
  blocked_by_intake_blockers: "Transmission suspendue : un point bloquant est ouvert.",
  feature_disabled: "Moteur de processus désactivé.",
  cross_tenant_forbidden: "Dossier introuvable ou processus non ouvert.",
  unknown_step: "Étape inconnue.",
  invalid_state: "L'état du dossier a changé. Rafraîchissez la page.",
};

export type TransitHandoffPrereq = { code: string; labelFr: string };

export function TransitHandoff({
  fileId,
  handoffSent,
  canSend,
  prerequisites,
}: {
  fileId: string;
  handoffSent: boolean;
  canSend: boolean;
  /** Unmet prerequisites, already resolved server-side. Empty ⇒ transmissible. */
  prerequisites: TransitHandoffPrereq[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
              startTransition(async () => {
                const res = await handDossierToTransit(fileId);
                if (!res.ok) setError(ERROR_FR[String(res.error)] ?? "Transmission impossible.");
                else router.refresh();
              });
            }}
            className="min-h-[36px] rounded-lg bg-navy-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            Transmettre au Transit
          </button>
        )}
      </div>

      {blocked && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            Transmission impossible — prérequis non satisfaits :
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
            {prerequisites.map((p) => (
              <li key={p.code}>{p.labelFr}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

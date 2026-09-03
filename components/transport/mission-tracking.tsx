"use client";

/**
 * TMS-1C — external provider link. SECONDARY since TMS-2.
 * ---------------------------------------------------------------------------
 * DEMOTED, NOT DELETED (TMS-2 §18, option A+C). The normal Effitrans tracking
 * workflow is now the chauffeur's own GPS: Transport assigns, the driver taps
 * « Démarrer la mission », and the live map follows the vehicle. No operator
 * should have to type a provider name or paste a URL to track a mission.
 *
 * This panel survives as an OPTIONAL FALLBACK for a fleet-GPS provider
 * integration, folded into a collapsed « Suivi externe (optionnel) »
 * disclosure so it never competes with the primary flow. Migration 135, the
 * table, its RLS and every TMS-1C security property are untouched — the data
 * and its guarantees are still there, only the prominence changed.
 * ---------------------------------------------------------------------------
 * The provider platform stays the live view; this is the governed doorway to
 * it. The link opens in a NEW TAB so the Effitrans tab — the system of record —
 * is never navigated away from mid-mission.
 *
 * THE FULL URL APPEARS ONLY AS THE ANCHOR'S href. If the provider signs its
 * links, the signature must not be rendered as text, put in a title attribute
 * or logged; the operator is shown the provider name and host instead.
 *
 * Nothing here decides anything: attaching and ending are server actions under
 * `transport:assign`, and neither moves the mission. Tracking ended is not
 * delivered — the POD remains the only proof.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  attachMissionTracking,
  endMissionTracking,
  removeMissionTracking,
  type TrackingActionResult,
} from "@/lib/transport/tracking-actions";
import {
  trackingState,
  canFollowLive,
  trackingDisplayHost,
  TRACKING_STATE_LABEL_FR,
  type TrackingReference,
} from "@/lib/transport/tracking-reference";

const ERR: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation de gérer le suivi de cette mission.",
  not_found: "Mission introuvable.",
  provider_required: "Le nom du prestataire est obligatoire.",
  url_required: "Le lien de suivi est obligatoire.",
  url_invalid: "Ce lien n'est pas une adresse valide.",
  url_not_https: "Le lien doit être sécurisé (https).",
  url_too_long: "Ce lien est trop long.",
  already_ended: "Le suivi de cette mission est déjà clôturé.",
  generic: "L'action a échoué. Réessayez.",
};

const inp = "rounded-md border border-slate-200 px-2 py-1 text-sm";
const lab = "flex flex-col gap-1 text-xs text-slate-600";

export function MissionTracking({
  transportId,
  reference,
  canManage,
}: {
  transportId: string;
  /** null ⇒ NOT_CONFIGURED. Resolved server-side under transport:read. */
  reference: TrackingReference | null;
  /** transport:assign — dispatch-time authority, same as vehicle/driver. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);

  const state = trackingState(reference);
  const host = reference ? trackingDisplayHost(reference.trackingUrl) : null;

  function run(fn: () => Promise<TrackingActionResult>, form?: HTMLFormElement) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: "Enregistré." } : { ok: false, text: ERR[r.error] ?? ERR.generic });
      if (r.ok) { form?.reset(); setEditing(false); router.refresh(); }
    });
  }

  return (
    <details className="surface p-4">
      <summary className="cursor-pointer text-sm font-semibold text-navy-900">
        Suivi externe (optionnel)
      </summary>
      <div className="mt-3 space-y-3">
      <p className="text-xs text-slate-500">
        Le suivi Effitrans se fait normalement par l&apos;application chauffeur
        (« Démarrer la mission »). Ce bloc ne sert qu&apos;au rattachement d&apos;un
        prestataire GPS externe, et ne détermine ni la livraison ni le POD.
      </p>

      {/* AVAILABLE — the doorway. */}
      {canFollowLive(reference) && reference ? (
        <div className="space-y-1">
          <a
            href={reference.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-teal-100"
          >
            Suivre la mission en direct
            <span aria-hidden="true">↗</span>
            <span className="sr-only">(ouvre le site du prestataire dans un nouvel onglet)</span>
          </a>
          <p className="text-xs text-slate-500">
            Prestataire : <strong>{reference.provider}</strong>
            {host ? <> · {host}</> : null}
            {reference.externalReference ? <> · réf. {reference.externalReference}</> : null}
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">{TRACKING_STATE_LABEL_FR[state]}</p>
      )}

      {state === "ENDED" && reference?.endReason && (
        <p className="text-xs text-slate-400">Motif : {reference.endReason}</p>
      )}

      {/* Management — transport:assign only. The server asserts it again. */}
      {canManage && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {!editing ? (
            <div className="flex flex-wrap gap-2">
              <button
                disabled={pending}
                onClick={() => { setEditing(true); setMsg(null); }}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-navy-700 disabled:opacity-40"
              >
                {reference ? "Modifier le suivi…" : "Associer un suivi en direct…"}
              </button>
              {reference && !reference.endedAt && (
                <button
                  disabled={pending}
                  onClick={() => run(() => endMissionTracking(transportId, "Mission terminée côté prestataire"))}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-40"
                >
                  Clôturer le suivi
                </button>
              )}
              {reference && (
                <button
                  disabled={pending}
                  onClick={() => run(() => removeMissionTracking(transportId))}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
                >
                  Retirer la référence
                </button>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                const d = new FormData(f);
                run(() => attachMissionTracking({
                  transportId,
                  provider: String(d.get("provider") ?? ""),
                  trackingUrl: String(d.get("trackingUrl") ?? ""),
                  externalReference: String(d.get("externalReference") ?? "") || null,
                }), f);
              }}
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              <label className={lab}>
                Prestataire
                <input name="provider" required defaultValue={reference?.provider ?? ""} className={inp} />
              </label>
              <label className={lab}>
                Lien de suivi (https)
                <input
                  name="trackingUrl"
                  required
                  type="url"
                  inputMode="url"
                  placeholder="https://…"
                  defaultValue={reference?.trackingUrl ?? ""}
                  className={inp}
                />
              </label>
              <label className={lab}>
                Référence prestataire (facultatif)
                <input name="externalReference" defaultValue={reference?.externalReference ?? ""} className={inp} />
              </label>
              <div className="sm:col-span-3 flex flex-wrap gap-2">
                <button
                  disabled={pending}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-navy-700 disabled:opacity-50"
                >
                  Enregistrer le suivi
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => { setEditing(false); setMsg(null); }}
                  className="rounded-md px-2 py-1.5 text-xs text-slate-500"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {msg && <p className={`text-xs ${msg.ok ? "text-teal-700" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </details>
  );
}

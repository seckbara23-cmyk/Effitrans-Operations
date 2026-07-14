"use client";
/**
 * Courier mission card (Phase 5.0D-3) — mobile-first. Mutates NOTHING itself.
 * ---------------------------------------------------------------------------
 * Every button calls a server action in lib/deposit/actions.ts, which
 * re-authenticates, re-checks the ASSIGNMENT, validates the state machine, and
 * writes an immutable custody event. Nothing here is trusted.
 *
 * Shows only what a courier needs to deliver. No finance data ever reaches here.
 */
import { useRef, useState, useTransition } from "react";
import type { DepositView } from "@/lib/deposit/service";
import {
  acceptAssignment,
  declineAssignment,
  failDeposit,
  recordDeposit,
  startDeposit,
  submitProof,
  uploadProofOfDeposit,
} from "@/lib/deposit/actions";

const ERROR_FR: Record<string, string> = {
  feature_disabled: "Fonctionnalité désactivée.",
  forbidden: "Action non autorisée.",
  not_assigned_courier: "Cette mission ne vous est pas affectée.",
  not_accepted: "Acceptez d'abord la mission.",
  invalid_state: "La mission a changé d'état. Rafraîchissez la page.",
  reason_required: "Un motif est obligatoire.",
  recipient_required: "Le nom du destinataire est obligatoire.",
  proof_required: "Une preuve de dépôt est obligatoire.",
  invalid_mime: "Format non accepté (JPEG, PNG ou PDF).",
  upload_failed: "Le téléversement a échoué.",
  not_found: "Mission introuvable.",
};

const btn = "rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50";

export function CourierMissionCard({ mission }: { mission: DepositView }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [recipientRole, setRecipientRole] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(ERROR_FR[r.error ?? ""] ?? "Action refusée.");
    });
  };

  const withReason = (fn: (reason: string) => Promise<{ ok: boolean; error?: string }>) => {
    const reason = window.prompt("Motif (obligatoire) :")?.trim();
    if (!reason) {
      setError("Un motif est obligatoire.");
      return;
    }
    run(() => fn(reason));
  };

  const s = mission.courierSection;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2">
        <div className="text-sm font-semibold text-navy-900">{mission.clientName}</div>
        <div className="text-xs text-slate-500">
          {mission.packageReference ?? mission.invoiceNumber ?? mission.fileNumber}
        </div>
      </div>

      {mission.clientLocation && (
        <p className="mb-1 text-sm text-slate-700">📍 {mission.clientLocation}</p>
      )}
      {mission.deliveryInstructions && (
        <p className="mb-2 text-xs text-slate-500">{mission.deliveryInstructions}</p>
      )}

      {mission.blocker && (
        <p className="mb-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{mission.blocker}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {s === "awaiting_acceptance" && (
          <>
            <button
              className={`${btn} bg-teal-600 text-white hover:bg-teal-700`}
              disabled={pending}
              onClick={() => run(() => acceptAssignment(mission.id))}
            >
              Accepter
            </button>
            <button
              className={`${btn} border border-slate-300 bg-white text-slate-700`}
              disabled={pending}
              onClick={() => withReason((r) => declineAssignment(mission.id, r))}
            >
              Décliner
            </button>
          </>
        )}

        {s === "ready_to_depart" && (
          <button
            className={`${btn} bg-navy-900 text-white hover:bg-navy-800`}
            disabled={pending}
            onClick={() => run(() => startDeposit(mission.id))}
          >
            Partir
          </button>
        )}

        {(s === "in_progress" || s === "deposit_details_required") && (
          <div className="w-full space-y-2">
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Nom du destinataire (obligatoire)"
              className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={recipientRole}
              onChange={(e) => setRecipientRole(e.target.value)}
              placeholder="Fonction du destinataire"
              className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                className={`${btn} bg-navy-900 text-white hover:bg-navy-800`}
                disabled={pending || recipient.trim() === ""}
                onClick={() =>
                  run(() =>
                    recordDeposit(mission.id, {
                      recipientName: recipient,
                      recipientRole: recipientRole || undefined,
                    }),
                  )
                }
              >
                Déposé
              </button>
              <button
                className={`${btn} border border-red-300 bg-white text-red-700`}
                disabled={pending}
                onClick={() => withReason((r) => failDeposit(mission.id, r))}
              >
                Échec
              </button>
            </div>
          </div>
        )}

        {(s === "proof_upload_required" || s === "proof_rejected") && (
          <div className="w-full space-y-2">
            {mission.recipientName && (
              <p className="text-xs text-slate-500">Destinataire : {mission.recipientName}</p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="w-full text-xs"
            />
            <div className="flex gap-2">
              <button
                className={`${btn} border border-slate-300 bg-white text-slate-700`}
                disabled={pending}
                onClick={() => {
                  const f = fileRef.current?.files?.[0];
                  if (!f) {
                    setError("Sélectionnez une preuve.");
                    return;
                  }
                  const fd = new FormData();
                  fd.set("file", f);
                  run(() => uploadProofOfDeposit(mission.id, fd));
                }}
              >
                Téléverser la preuve
              </button>
              <button
                className={`${btn} bg-teal-600 text-white hover:bg-teal-700`}
                disabled={pending || !mission.proofDocumentId}
                title={!mission.proofDocumentId ? "Téléversez d'abord une preuve" : undefined}
                onClick={() => run(() => submitProof(mission.id))}
              >
                Transmettre
              </button>
            </div>
          </div>
        )}

        {s === "proof_under_review" && (
          <p className="text-xs text-slate-500">Preuve transmise. En attente du contrôle Administration.</p>
        )}
        {s === "completed" && <p className="text-xs text-emerald-700">Mission terminée.</p>}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </article>
  );
}

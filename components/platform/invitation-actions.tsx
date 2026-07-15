"use client";

/**
 * Per-user invitation controls (Phase 6.0E-3). CLIENT.
 * ---------------------------------------------------------------------------
 * Resend / Regenerate link / Cancel, shown only for the states where each is eligible
 * (canResendInvitation / canCancelInvitation). Holds no authority — it calls the
 * platform-gated actions, which re-authorize and re-check eligibility server-side.
 *
 * A regenerated / returned setup link is shown ONCE, in a visually-distinguished box
 * with a Copy button and a warning that navigation removes it. It is never placed in a
 * toast, a URL, storage, a log, or an audit payload. Cancel is disruptive, so it goes
 * through a confirmation dialog (never window.confirm).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  resendTenantInvitation,
  regenerateTenantSetupLink,
  cancelTenantInvitation,
  type InvitationOpResult,
} from "@/lib/platform/invitation-actions";
import { canResendInvitation, canCancelInvitation, type InvitationState } from "@/lib/users/invitation-state";
import { CopyButton } from "./copy-button";

const WELCOME_FR: Record<string, string> = {
  email_sent: "E-mail d'invitation envoyé.",
  link_returned: "Aucun fournisseur d'e-mail : lien à transmettre ci-dessous.",
  provider_unavailable: "Fournisseur d'e-mail indisponible.",
  link_generation_failed: "Impossible de générer le lien.",
  delivery_failed: "Échec de l'envoi.",
  skipped: "Ignoré.",
};

export function InvitationActions({
  tenantId,
  userId,
  state,
}: {
  tenantId: string;
  userId: string;
  state: InvitationState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [oneTimeLink, setOneTimeLink] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const showResend = canResendInvitation(state);
  const showCancel = canCancelInvitation(state);
  if (!showResend && !showCancel) return null;

  function run(action: () => Promise<InvitationOpResult>, okMessage?: string) {
    setStatus(null);
    setOneTimeLink(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        if (res.setupLink) setOneTimeLink(res.setupLink);
        setStatus({
          tone: "ok",
          message: okMessage ?? (res.welcome ? (WELCOME_FR[res.welcome] ?? "Fait.") : "Fait."),
        });
        router.refresh();
      } else {
        const msg =
          res.error === "unauthorized" ? "Action non autorisée."
          : res.error === "not_found" ? "Utilisateur introuvable."
          : res.error === "ineligible" ? "Action non applicable à cet utilisateur."
          : "Échec de l'opération.";
        setStatus({ tone: "error", message: msg });
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {showResend && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => resendTenantInvitation(tenantId, userId))}
              className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-40"
            >
              {pending ? "…" : "Renvoyer"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => regenerateTenantSetupLink(tenantId, userId), "Nouveau lien généré ci-dessous.")}
              className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-40"
            >
              Régénérer le lien
            </button>
          </>
        )}
        {showCancel && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmCancel(true)}
            className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-40"
          >
            Annuler l'invitation
          </button>
        )}
      </div>

      {status && (
        <p aria-live="polite" className={`text-xs font-medium ${status.tone === "ok" ? "text-emerald-300" : "text-red-400"}`}>
          {status.message}
        </p>
      )}

      {/* The one-time setup link — visually distinguished, shown once, never persisted. */}
      {oneTimeLink && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" role="status" aria-live="polite">
          <p className="text-[11px] font-semibold text-amber-200">Lien de configuration à usage unique</p>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              readOnly
              value={oneTimeLink}
              aria-label="Lien de configuration à usage unique"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full truncate rounded border border-white/10 bg-navy-950 px-2 py-1 font-mono text-[11px] text-slate-200"
            />
            <CopyButton value={oneTimeLink} label="Copier le lien" />
          </div>
          <p className="mt-1.5 text-[11px] text-amber-200/80">
            Transmettez-le en personne ou par un canal sûr. Il disparaît si vous actualisez ou quittez la page,
            et n'est jamais enregistré. Ne l'envoyez jamais avec un mot de passe.
          </p>
        </div>
      )}

      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-navy-950 p-6">
            <h3 className="text-lg font-semibold text-white">Annuler l'invitation</h3>
            <p className="mt-2 text-sm text-slate-300">
              L'utilisateur sera désactivé : son lien de configuration en attente ne pourra plus ouvrir de session,
              même s'il définit un mot de passe. Aucune donnée n'est supprimée ; vous pourrez le réactiver plus tard.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                disabled={pending}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirmCancel(false);
                  run(() => cancelTenantInvitation(tenantId, userId), "Invitation annulée.");
                }}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-40"
              >
                {pending ? "…" : "Confirmer l'annulation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

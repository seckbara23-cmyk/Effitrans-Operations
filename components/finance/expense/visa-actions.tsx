"use client";
/**
 * Autorisation de Dépenses — sign / reject / return (Phase 11.0D). Client.
 * ---------------------------------------------------------------------------
 * The three approval decisions, each invoking the ONE server action, which
 * re-asserts the permission and re-runs the pure eligibility evaluator. What is
 * rendered here is a convenience, never an authorization: hiding a button grants
 * nothing and showing one bypasses nothing.
 *
 * A refusal (rejet / retour) REQUIRES a reason — the platform's fail-closed audit
 * rule — so the confirm button stays disabled until one is written.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordExpenseVisa } from "@/lib/finance/expense/actions";
import { SIGN_REFUSAL_LABELS_FR, type SignRefusal } from "@/lib/finance/expense/visa";

const ERRORS: Record<string, string> = {
  ...SIGN_REFUSAL_LABELS_FR,
  forbidden: "Vous n'avez pas l'autorisation d'apposer un visa.",
  not_found: "Cette autorisation est introuvable.",
  invalid_state: "Le document a changé entre-temps. Rechargez la page avant de signer.",
  invalid_input: "Un motif est obligatoire pour un refus ou un retour.",
};

type Mode = "REJECTED" | "RETURNED";

export function VisaActions({
  id,
  stepLabelFr,
  canSign,
  refusal,
}: {
  id: string;
  stepLabelFr: string | null;
  canSign: boolean;
  refusal: SignRefusal | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [comment, setComment] = useState("");
  const [confirmingApproval, setConfirmingApproval] = useState(false);

  function submit(decision: "APPROVED" | Mode) {
    setError(null);
    startTransition(async () => {
      const res = await recordExpenseVisa(id, decision, comment.trim() || undefined);
      if (!res.ok) {
        setError(ERRORS[res.error] ?? "L'opération a échoué.");
        return;
      }
      setMode(null);
      setComment("");
      setConfirmingApproval(false);
      router.refresh();
    });
  }

  // Not the caller's step — explain why, in the chain's own words, and stop.
  if (!canSign) {
    if (!refusal || refusal === "chain_complete") return null;
    return (
      <div className="surface p-4">
        <p className="text-xs text-slate-500">{SIGN_REFUSAL_LABELS_FR[refusal]}</p>
      </div>
    );
  }

  return (
    <section className="surface space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-navy-900">Votre visa est attendu</h2>
        {stepLabelFr && <p className="text-xs text-slate-500">Étape : {stepLabelFr}</p>}
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}

      {mode === null && !confirmingApproval && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setConfirmingApproval(true)}
            className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            Approuver
          </button>
          <button
            onClick={() => setMode("RETURNED")}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-navy-900 hover:border-amber-300"
          >
            Retourner pour correction
          </button>
          <button
            onClick={() => setMode("REJECTED")}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:border-red-300"
          >
            Rejeter
          </button>
        </div>
      )}

      {confirmingApproval && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-500" htmlFor="visa-comment">
            Commentaire (facultatif)
          </label>
          <textarea
            id="visa-comment"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-teal-400 focus:outline-none"
          />
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Votre visa sera enregistré de façon définitive, horodaté à votre nom et rattaché à cette
            version exacte du document. Il ne pourra être ni modifié ni supprimé.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => submit("APPROVED")}
              disabled={pending}
              className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {pending ? "Enregistrement…" : "Confirmer le visa"}
            </button>
            <button
              onClick={() => { setConfirmingApproval(false); setComment(""); }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {mode !== null && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-500" htmlFor="refusal-comment">
            Motif {mode === "REJECTED" ? "du rejet" : "du retour"} *
          </label>
          <textarea
            id="refusal-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-teal-400 focus:outline-none"
          />
          <p className="text-[11px] text-slate-500">
            {mode === "REJECTED"
              ? "Le rejet clôt ce tour d'approbation. L'historique et toutes les versions sont conservés."
              : "Le retour renvoie le document en correction. Toute modification créera une nouvelle version et le circuit reprendra."}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => submit(mode)}
              disabled={pending || comment.trim().length === 0}
              className="rounded-lg bg-navy-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {pending ? "Enregistrement…" : mode === "REJECTED" ? "Confirmer le rejet" : "Confirmer le retour"}
            </button>
            <button
              onClick={() => { setMode(null); setComment(""); }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

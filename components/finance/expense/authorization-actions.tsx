"use client";
/**
 * Autorisation de Dépenses — lifecycle controls (Phase 11.0C). Client component.
 * ---------------------------------------------------------------------------
 * Submit, print, and the 11.0D voucher seam. The buttons are presentation only:
 * every action re-asserts its permission and its state transition server-side —
 * hiding a button is never authorization.
 *
 * « Créer le Bon de Dépenses » appears ONLY on an APPROVED authorization
 * (DEC-C06) and stays disabled here: voucher editing is 11.0D. No approval path
 * exists in 11.0C, so this is a seam, not a dead end presented as a feature.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitExpenseAuthorization } from "@/lib/finance/expense/actions";
import type { AuthorizationStatus } from "@/lib/finance/expense/types";

const ERRORS: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation de soumettre ce document.",
  not_found: "Cette autorisation est introuvable.",
  invalid_state: "Cette autorisation ne peut pas être soumise dans son état actuel.",
  invalid_input: "Complétez le document avant de le soumettre.",
};

export function AuthorizationActions({
  id,
  status,
  canSubmit,
  canExport,
  hasVoucher,
}: {
  id: string;
  status: AuthorizationStatus;
  canSubmit: boolean;
  canExport: boolean;
  hasVoucher: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const submittable = status === "DRAFT" || status === "RETURNED";

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitExpenseAuthorization(id);
      if (!res.ok) {
        setError(ERRORS[res.error] ?? "La soumission a échoué.");
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {canExport && (
          <a
            href={`/api/finance/expense-authorizations/${id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-navy-900 hover:border-teal-300"
          >
            Imprimer / Télécharger le PDF
          </a>
        )}

        {canSubmit && submittable && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            Soumettre
          </button>
        )}

        {canSubmit && submittable && confirming && (
          <>
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {pending ? "Soumission…" : "Confirmer la soumission"}
            </button>
            <button onClick={() => setConfirming(false)} className="text-xs text-slate-400 hover:text-slate-600">
              Annuler
            </button>
          </>
        )}

        {/* DEC-C06 seam — only ever offered on an APPROVED authorization. */}
        {status === "APPROVED" && !hasVoucher && (
          <button
            disabled
            title="La création du Bon de Dépenses sera activée en phase 11.0D."
            className="cursor-not-allowed rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-400"
          >
            Créer le Bon de Dépenses
          </button>
        )}
      </div>

      {confirming && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          La soumission attribue le numéro d'autorisation, fige une version immuable du document et le rend
          non modifiable. Cette action est définitive.
        </p>
      )}
    </div>
  );
}

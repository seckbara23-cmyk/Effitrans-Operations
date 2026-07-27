"use client";
/**
 * Document rejection control (Phase WES-4F). Client component.
 * ---------------------------------------------------------------------------
 * Replaces `window.prompt(...)`, which collected one unstructured sentence and
 * wrote it to `document.review_note`. That sentence was the ONLY record of why
 * a document was refused: unsearchable, unclassifiable, and — once WES-9
 * existed — either lost or copied into an immutable ledger where it could
 * never be corrected.
 *
 * Now the actor picks a CODE from a closed registry, and may add an
 * explanation. The code travels into the business event; the explanation stays
 * in the protected `document_review` record, reachable by governance and by
 * nobody else.
 *
 * The explanation box becomes mandatory for the codes that cannot stand alone
 * — "incohérence avec le dossier" says nothing useful without naming the
 * incoherence. The server and a database trigger re-check that.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rejectDocument } from "@/lib/documents/actions";
import { rejectionCodes, reasonCode } from "@/lib/documents/reason-codes";

const ERRORS_FR: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation de vérifier ce document.",
  not_found: "Document introuvable.",
  unknown_reason_code: "Motif de rejet invalide.",
  wrong_scope: "Motif de rejet invalide.",
  explanation_required: "Ce motif exige une explication.",
  reason_required: "Un motif structuré est obligatoire.",
  invalid_transition: "Ce document ne peut pas être rejeté dans son état actuel.",
  self_verification: "Vous ne pouvez pas vérifier un document que vous avez vous-même déposé.",
  not_a_verifier: "Votre rôle ne permet pas de vérifier ce document.",
  policy_unresolved:
    "La politique applicable à ce dossier n'a pas pu être déterminée. Vérification impossible.",
  review_failed: "Le rejet a échoué.",
};

export function RejectControl({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState<string | null>(null);

  const needsExplanation = code ? reasonCode(code)?.explanationRequired === true : false;
  const blocked = pending || !code || (needsExplanation && explanation.trim().length === 0);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await rejectDocument(documentId, code, explanation.trim() || null);
      if (!res.ok) {
        setError(ERRORS_FR[res.error ?? ""] ?? ERRORS_FR.review_failed);
        return;
      }
      setOpen(false);
      setCode("");
      setExplanation("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={pending}
        className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
      >
        Rejeter
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs"
      >
        <option value="">Motif du rejet…</option>
        {rejectionCodes().map((r) => (
          <option key={r.code} value={r.code}>
            {r.labelFr}
          </option>
        ))}
      </select>

      {code && (
        <input
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          placeholder={needsExplanation ? "Explication (obligatoire)" : "Explication (facultative)"}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
        />
      )}

      <button
        onClick={submit}
        disabled={blocked}
        className="rounded bg-red-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "…" : "Confirmer le rejet"}
      </button>
      <button
        onClick={() => { setOpen(false); setError(null); setCode(""); setExplanation(""); }}
        className="text-xs text-slate-400 hover:text-slate-600"
      >
        Annuler
      </button>

      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

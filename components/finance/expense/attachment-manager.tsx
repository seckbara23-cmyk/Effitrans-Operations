"use client";
/**
 * Pièces jointes — supporting documents (Phase 11.0C). Client component.
 * ---------------------------------------------------------------------------
 * Upload / list / download / retire the evidence attached to an Autorisation.
 * Every operation is a permission-gated server action; downloads go through a
 * per-request 60-second signed URL that is never rendered into the page source.
 *
 * Retire, never delete (8.1A): a withdrawn piece stays listed and struck
 * through, so the evidence set behind a document remains reconstructible.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getExpenseAttachmentUrl,
  retireExpenseAttachment,
  uploadExpenseAttachment,
} from "@/lib/finance/expense/attachments";
import { ALLOWED_MIME_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/documents/validate";

export type AttachmentItem = {
  id: string;
  fileName: string;
  kind: string | null;
  byteSize: number | null;
  retiredAt: string | null;
};

const ERRORS: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation d'effectuer cette action.",
  not_found: "Pièce jointe introuvable.",
  invalid_state: "Les pièces jointes ne sont plus modifiables à ce stade.",
  invalid_input: "Fichier refusé : format non autorisé ou taille supérieure à 25 Mo.",
  upload_failed: "Le téléversement a échoué. Réessayez.",
};

function humanSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function AttachmentManager({
  authorizationId,
  attachments,
  editable,
}: {
  authorizationId: string;
  attachments: AttachmentItem[];
  editable: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("");

  function upload(file: File) {
    setError(null);
    const form = new FormData();
    form.set("file", file);
    if (kind.trim()) form.set("kind", kind.trim());
    startTransition(async () => {
      const res = await uploadExpenseAttachment(authorizationId, form);
      if (fileRef.current) fileRef.current.value = "";
      if (!res.ok) {
        setError(ERRORS[res.error] ?? "Le téléversement a échoué.");
        return;
      }
      setKind("");
      router.refresh();
    });
  }

  function download(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await getExpenseAttachmentUrl(id);
      if (!res.ok) {
        setError(ERRORS[res.error] ?? "Téléchargement indisponible.");
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function retire(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await retireExpenseAttachment(id);
      if (!res.ok) {
        setError(ERRORS[res.error] ?? "Le retrait a échoué.");
        return;
      }
      router.refresh();
    });
  }

  const active = attachments.filter((a) => !a.retiredAt);

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">Pièces jointes</h2>
        <span className="text-xs text-slate-400">{active.length} pièce(s)</span>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}

      {attachments.length === 0 ? (
        <p className="text-xs text-slate-500">Aucune pièce justificative n'est encore jointe.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${a.retiredAt ? "text-slate-400 line-through" : "text-navy-900"}`}>
                  {a.fileName}
                </p>
                <p className="text-[11px] text-slate-400">
                  {[a.kind, humanSize(a.byteSize), a.retiredAt ? "retirée" : null].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <button
                onClick={() => download(a.id)}
                disabled={pending}
                className="text-xs text-teal-700 hover:underline disabled:opacity-50"
              >
                Télécharger
              </button>
              {editable && !a.retiredAt && (
                <button
                  onClick={() => retire(a.id)}
                  disabled={pending}
                  className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-50"
                >
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <div>
            <label className="block text-xs font-medium text-slate-500" htmlFor="attachment-kind">Nature</label>
            <input
              id="attachment-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder="Facture, devis, reçu…"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-teal-400 focus:outline-none"
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
            }}
            className="text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-teal-800"
          />
          <span className="text-[11px] text-slate-400">
            PDF, JPEG, PNG, Word, Excel — {Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} Mo maximum
          </span>
        </div>
      )}
    </section>
  );
}

"use client";

/**
 * Documents panel embedded on a dossier (Phase 1.8). Client component — upload
 * form (multipart via a server action) + list + "missing required" indicator.
 *
 * POD-UPLOAD-01 — IT CAN BE ASKED FOR A PARTICULAR DOCUMENT. A surface that
 * sends an operator here for one named artefact (« Déposer le bordereau
 * signé ») may pass `?docType=<CODE>`; the form then opens on that type and
 * says which one it is. Nothing else changes: the operator may still pick
 * anything in the list, and NOTHING is submitted for them — the deep link
 * chooses a value in a dropdown, it does not upload a file.
 *
 * THE VALIDATION IS THE LIST ITSELF. A requested code is honoured only when it
 * is one of the `types` this panel actually offers — which is already the
 * active, non-generatable catalogue. An unknown code, a retired one, a
 * generated-artifact code and a typo are all simply absent from that list, so
 * every one of them degrades to the ordinary « Sélectionner un type… » with no
 * special case to write and nothing to keep in sync.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { t } from "@/lib/i18n";
import { uploadDocument } from "@/lib/documents/actions";
import { documentLabelForTypeCode } from "@/lib/process/documents";
import { DocumentRow } from "./document-row";
import type { DocumentItem, DocumentTypeItem, MissingDocument } from "@/lib/documents/types";

export function DocumentsPanel({
  fileId,
  documents,
  types,
  missing,
  canCreate,
  canApprove,
  canDelete,
  canEmail = false,
}: {
  fileId: string;
  documents: DocumentItem[];
  types: DocumentTypeItem[];
  missing: MissingDocument[];
  canCreate: boolean;
  canApprove: boolean;
  canDelete: boolean;
  canEmail?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Honoured only if this panel genuinely offers it — see the header note.
  const requestedType = searchParams?.get("docType") ?? null;
  const expected = requestedType ? (types.find((ty) => ty.code === requestedType) ?? null) : null;
  // The OFFICIAL PROCESS name where the process names this artefact, the
  // catalogue's own wording otherwise. The two disagree for the signed POD
  // until the catalogue row is aligned, and the operator was instructed in the
  // process vocabulary — so that is the one that answers here.
  const expectedLabel = expected
    ? (documentLabelForTypeCode(expected.code) ?? expected.labelFr)
    : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await uploadDocument(fileId, fd);
      if (!res.ok) {
        const map = t.documents.errors as Record<string, string>;
        setError(map[res.error] ?? t.documents.errors.generic);
        return;
      }
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">{t.documents.panelTitle}</h2>
      </div>

      {missing.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <span className="font-semibold">{t.documents.missingTitle}:</span>{" "}
          {missing.map((m) => m.label).join(", ")}
        </div>
      )}

      {canCreate && (
        <form ref={formRef} onSubmit={onSubmit} className="surface flex flex-wrap items-end gap-2 p-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            {t.documents.type}
            {/* `defaultValue`, not `value`: the deep link chooses the opening
                selection and then gets out of the way — the field stays the
                operator's, uncontrolled, exactly as it was. */}
            <select
              name="typeCode"
              required
              defaultValue={expected?.code ?? ""}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            >
              <option value="">{t.documents.selectType}</option>
              {types.map((ty) => (
                <option key={ty.code} value={ty.code}>
                  {ty.labelFr}
                </option>
              ))}
            </select>
            {expectedLabel && (
              <span className="text-[11px] text-slate-500">
                {t.documents.expectedType} : {expectedLabel}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            {t.documents.file}
            <input
              type="file"
              name="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
              className="text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            {t.documents.expiryDate}
            <input type="date" name="expiryDate" className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {pending ? t.documents.uploading : t.documents.upload}
          </button>
          {error && <p className="w-full text-xs text-red-600">{error}</p>}
        </form>
      )}

      {documents.length === 0 ? (
        <div className="surface p-4 text-sm text-slate-500">{t.documents.empty}</div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} canApprove={canApprove} canDelete={canDelete} canEmail={canEmail} />
          ))}
        </div>
      )}
    </section>
  );
}

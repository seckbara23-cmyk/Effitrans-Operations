"use client";

/**
 * Documents panel embedded on a dossier (Phase 1.8). Client component — upload
 * form (multipart via a server action) + list + "missing required" indicator.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { uploadDocument } from "@/lib/documents/actions";
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
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
            <select name="typeCode" required className="rounded-md border border-slate-200 px-2 py-1 text-sm">
              <option value="">{t.documents.selectType}</option>
              {types.map((ty) => (
                <option key={ty.code} value={ty.code}>
                  {ty.labelFr}
                </option>
              ))}
            </select>
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

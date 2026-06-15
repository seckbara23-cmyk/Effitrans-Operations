"use client";

/**
 * A single document row with inline controls (Phase 1.8). Client component —
 * invokes server-action proxies only (download mints a short-TTL signed URL).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import {
  approveDocument,
  createDocumentDownloadUrl,
  deleteDocument,
  rejectDocument,
} from "@/lib/documents/actions";
import { canReview } from "@/lib/documents/status";
import type { ActionResult, DocumentItem } from "@/lib/documents/types";

const STATUS_STYLE: Record<string, string> = {
  UPLOADED: "bg-slate-100 text-slate-600",
  PENDING_REVIEW: "bg-sky-50 text-sky-700",
  APPROVED: "bg-teal-50 text-teal-700",
  REJECTED: "bg-red-50 text-red-700",
  EXPIRED: "bg-amber-50 text-amber-700",
};
const EXPIRY_STYLE: Record<string, string> = {
  expired: "text-red-600 font-semibold",
  expiring: "text-amber-600 font-semibold",
  valid: "text-slate-500",
  none: "text-slate-400",
};

export function DocumentRow({
  doc,
  canApprove,
  canDelete,
}: {
  doc: DocumentItem;
  canApprove: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: (r: ActionResult) => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = t.documents.errors as Record<string, string>;
        setError(map[res.error] ?? t.documents.errors.generic);
        return;
      }
      onOk?.(res);
      router.refresh();
    });
  }

  function download() {
    run(
      () => createDocumentDownloadUrl(doc.id),
      (res) => {
        if (res.ok && res.url) window.open(res.url, "_blank", "noopener");
      },
    );
  }

  function reject() {
    const note = window.prompt(t.documents.rejectPrompt) ?? undefined;
    run(() => rejectDocument(doc.id, note));
  }

  const reviewable = canApprove && canReview(doc.status);

  return (
    <div className="surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-navy-900">{doc.typeLabel}</span>
        {doc.title && <span className="truncate text-xs text-slate-500">{doc.title}</span>}
        <span className="ml-auto flex items-center gap-2">
          {doc.expiryDate && (
            <span className={`text-xs ${EXPIRY_STYLE[doc.expiryState]}`}>
              {doc.expiryState !== "none" && doc.expiryState !== "valid"
                ? `${t.documents.expiry[doc.expiryState]} · `
                : ""}
              {doc.expiryDate}
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[doc.status]}`}>
            {t.documents.statuses[doc.status]}
          </span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>
          {t.documents.uploadedBy}: {doc.uploadedByEmail ?? "—"}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={download}
            disabled={pending}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {t.documents.download}
          </button>
          {reviewable && (
            <>
              <button
                onClick={() => run(() => approveDocument(doc.id))}
                disabled={pending}
                className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
              >
                {t.documents.approve}
              </button>
              <button
                onClick={reject}
                disabled={pending}
                className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {t.documents.reject}
              </button>
            </>
          )}
          {canDelete && (
            <button
              onClick={() => run(() => deleteDocument(doc.id))}
              disabled={pending}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {t.documents.delete}
            </button>
          )}
        </span>
      </div>

      {doc.reviewNote && <p className="mt-1 text-xs text-red-600">{doc.reviewNote}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

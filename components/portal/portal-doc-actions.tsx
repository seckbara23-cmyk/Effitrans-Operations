"use client";

/**
 * Portal document actions (Phase 3.3 D7) — Aperçu + Télécharger. Both reuse the
 * EXISTING signed-URL action (getPortalDocumentDownloadUrl); opening the signed
 * URL in a new tab serves as the preview. No new download infrastructure.
 */
import { useState, useTransition } from "react";
import { getPortalDocumentDownloadUrl } from "@/lib/portal/docs-actions";
import { t } from "@/lib/i18n";

export function PortalDocActions({ documentId }: { documentId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  function open() {
    setError(false);
    start(async () => {
      const res = await getPortalDocumentDownloadUrl(documentId);
      if (res.ok && res.url) window.open(res.url, "_blank", "noopener");
      else setError(true);
    });
  }

  const d = t.portal.premium.documents;
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={open}
        disabled={pending}
        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {d.preview}
      </button>
      <button
        onClick={open}
        disabled={pending}
        className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-50"
      >
        {d.download}
      </button>
      {error && <span className="text-xs text-red-600">{t.portal.documents.downloadFailed}</span>}
    </div>
  );
}

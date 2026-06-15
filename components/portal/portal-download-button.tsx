"use client";

import { useState, useTransition } from "react";
import { getPortalDocumentDownloadUrl } from "@/lib/portal/docs-actions";
import { t } from "@/lib/i18n";

export function PortalDownloadButton({ documentId }: { documentId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  function download() {
    setError(false);
    start(async () => {
      const res = await getPortalDocumentDownloadUrl(documentId);
      if (res.ok && res.url) window.open(res.url, "_blank", "noopener");
      else setError(true);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={download}
        disabled={pending}
        className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
      >
        {t.portal.documents.download}
      </button>
      {error && <span className="text-xs text-red-600">{t.portal.documents.downloadFailed}</span>}
    </span>
  );
}

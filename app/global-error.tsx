"use client";

/**
 * Global error boundary (Phase 1.18 — C1). Catches errors thrown in the ROOT
 * layout itself (which app/error.tsx cannot). Must render its own <html>/<body>.
 * Reports through the observability seam, then offers a retry.
 */
import { useEffect } from "react";
import { reportError } from "@/lib/observability/report";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { scope: "client", event: "global-error", extra: { digest: error.digest } });
  }, [error]);

  return (
    <html lang="fr">
      <body className="font-sans antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <h1 className="text-lg font-semibold text-navy-900">
            Une erreur est survenue
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            L&apos;application a rencontré un problème inattendu. Veuillez réessayer.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}

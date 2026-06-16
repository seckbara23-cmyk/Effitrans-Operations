"use client";

/**
 * Portal error boundary (Phase 1.18 — C1). The portal is a separate surface with
 * no internal app chrome, so it gets its own boundary (the staff app/error.tsx
 * does not apply here). Reports through the observability seam, then offers a
 * retry without leaking internals to the client.
 */
import { useEffect } from "react";
import { reportError } from "@/lib/observability/report";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { scope: "portal", event: "portal-error", extra: { digest: error.digest } });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-semibold text-navy-900">Une erreur est survenue</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
        Le chargement de cette page a échoué. Veuillez réessayer ; si le problème
        persiste, contactez votre interlocuteur Effitrans.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
      >
        Réessayer
      </button>
    </div>
  );
}

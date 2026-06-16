"use client";

/**
 * Global error boundary (Phase 1.17A). Catches uncaught render/data errors in
 * any segment below the root layout and offers a retry, instead of leaking a
 * stack trace or a blank screen. Keep it dependency-free so it always renders.
 */
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the server logs (and any future error monitor) without
    // exposing details to the user.
    console.error("[app:error]", error);
  }, [error]);

  return (
    <div className="animate-fade-in">
      <div className="surface flex flex-col items-center justify-center px-6 py-16 text-center">
        <span className="eyebrow mb-2">Erreur</span>
        <h1 className="max-w-md text-lg font-semibold text-navy-900">
          Une erreur est survenue
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          Le chargement de cette page a échoué. Vous pouvez réessayer ; si le
          problème persiste, contactez l&apos;administrateur.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Centre d'Opérations — refresh control (Phase 10.0C, Scope A).
 * Re-runs the existing server request (router.refresh) — the platform's normal
 * request-driven refresh. NOT polling, NOT Realtime: a manual, on-demand action.
 * The label is deliberately "Actualiser" — no "live"/"temps réel" claim.
 */
export function CockpitRefresh({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);

  const onClick = () => {
    setSpinning(true);
    startTransition(() => {
      router.refresh();
      // The transition ends when the server components re-render; clear the hint then.
      setTimeout(() => setSpinning(false), 600);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={className}
      aria-label="Actualiser le Centre d'opérations"
    >
      <span aria-hidden className={spinning ? "inline-block animate-spin" : "inline-block"}>
        ↻
      </span>{" "}
      Actualiser
    </button>
  );
}

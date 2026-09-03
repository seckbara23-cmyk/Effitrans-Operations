"use client";

/**
 * TMS-2D §10 — keeping the command centre live, with the smallest mechanism
 * the repository already uses.
 *
 * The page is a server component with `revalidate = 0`, so `router.refresh()`
 * re-runs its queries and streams new telemetry in without a full page load
 * and without changing the page's structure. That is the Messaging Center's
 * polling idiom (Phase 8.7 chose polling over Realtime deliberately), so no
 * new infrastructure, no socket, no endpoint and no dependency is introduced —
 * and `TRACKING_REALTIME_ENABLED` stays dark and untouched.
 *
 * The interval is deliberately slower than the driver's own reporting rhythm
 * (a position is written at most every 60 s / 250 m), so refreshing faster
 * would re-query for data that cannot have changed.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export const LIVE_REFRESH_MS = 30_000;

export function LiveRefresh({ intervalMs = LIVE_REFRESH_MS }: { intervalMs?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      // Refreshing a hidden tab burns queries nobody is reading.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, paused]);

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span aria-hidden="true">{paused ? "⏸" : "🟢"}</span>
      <span>
        {paused
          ? "Actualisation automatique en pause."
          : `Actualisation automatique toutes les ${Math.round(intervalMs / 1000)} s.`}
      </span>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-teal-300"
      >
        {paused ? "Reprendre" : "Suspendre"}
      </button>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-teal-300"
      >
        Actualiser maintenant
      </button>
    </div>
  );
}

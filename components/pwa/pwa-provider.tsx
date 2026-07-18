"use client";

/**
 * PWA runtime (Phase 8.3, install redesigned 8.5). CLIENT — mounted once in the root layout,
 * on every surface.
 * ---------------------------------------------------------------------------
 * Two independent concerns; neither touches business data:
 *
 * 1. SERVICE-WORKER lifecycle — registers /sw.js ONLY when NEXT_PUBLIC_PWA_ENABLED="true"
 *    (dark by default: Preview first, production after acceptance — Phase 8.3 §S). When a new
 *    worker is WAITING, shows a non-disruptive banner; activation happens only on the user's
 *    click (SKIP_WAITING → single guarded reload — never during form entry on its own, never
 *    a refresh loop).
 * 2. NETWORK status — offline banner + reconnection confirmation. navigator.onLine is treated
 *    as a HINT only (it can be true while the backend is unreachable); real requests keep
 *    their real error states — this banner never suppresses or replaces them.
 *
 * The INSTALL prompt (Phase 8.5) now lives in components/pwa/pwa-install-context.tsx
 * (state) — this file only renders the small first-visit banner from that shared state, so
 * the compact header action (PwaInstallAction) and this banner never disagree about
 * installability. See docs/pwa-mobile-architecture.md for the full rationale.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePwaInstall } from "./pwa-install-context";

// ---------------------------------------------------------------- service worker ----

function useServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const reloaded = useRef(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PWA_ENABLED !== "true") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (cancelled) return;
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          installing?.addEventListener("statechange", () => {
            // installed + an active controller ⇒ a NEW version is waiting behind the current one.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(reg.waiting ?? installing);
            }
          });
        });
      })
      .catch(() => {
        /* registration failure is non-fatal — the app works identically without a SW */
      });

    // Surface the build identifier in the update UI (secret-free endpoint from 8.0B).
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { sha?: string | null } | null) => {
        if (!cancelled && v?.sha) setVersion(v.sha.slice(0, 7));
      })
      .catch(() => {});

    // One guarded reload after the user-approved activation — never a loop.
    const onControllerChange = () => {
      if (reloaded.current) return;
      reloaded.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const activate = useCallback(() => {
    waiting?.postMessage("SKIP_WAITING");
  }, [waiting]);

  return { waiting: Boolean(waiting), version, activate };
}

// ---------------------------------------------------------------- network status ----

function useNetworkStatus() {
  const [offline, setOffline] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    // Initial state is a hint only — never block anything on it.
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const onOffline = () => {
      setRestored(false);
      setOffline(true);
    };
    const onOnline = () => {
      setOffline(false);
      setRestored(true);
      // The confirmation is transient; requests still prove reachability themselves.
      const t = setTimeout(() => setRestored(false), 4000);
      return () => clearTimeout(t);
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return { offline, restored };
}

// ---------------------------------------------------------------- UI ----

export function PwaProvider() {
  const sw = useServiceWorker();
  const pwa = usePwaInstall();
  const net = useNetworkStatus();

  return (
    <div aria-live="polite">
      {/* Offline / restored — top banner, above everything, safe-area aware. */}
      {net.offline && (
        <div role="status" className="fixed inset-x-0 top-0 z-[100] bg-amber-600 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-center text-sm font-medium text-white">
          Hors ligne — les données en direct sont indisponibles. Aucune modification n'est enregistrée hors connexion.
        </div>
      )}
      {!net.offline && net.restored && (
        <div role="status" className="fixed inset-x-0 top-0 z-[100] bg-emerald-600 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-center text-sm font-medium text-white">
          Connexion rétablie.
        </div>
      )}

      {/* Update banner — non-disruptive; activation ONLY on click. */}
      {sw.waiting && (
        <div role="status" className="fixed inset-x-0 bottom-0 z-[100] flex flex-wrap items-center justify-center gap-3 bg-navy-900 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-sm text-white">
          <span>
            Nouvelle version disponible{sw.version ? ` (${sw.version})` : ""}. Vos saisies en cours ne seront pas perdues tant que vous ne rafraîchissez pas.
          </span>
          <button
            type="button"
            onClick={sw.activate}
            className="min-h-[44px] rounded-lg bg-teal-500 px-4 py-2 font-semibold text-white"
          >
            Mettre à jour
          </button>
        </div>
      )}

      {/* Install — compact, first-visit only, dismissible for ~30 days. Small corner card
          rather than a full-width bar so it never covers operational content; the
          equivalent action remains reachable from the header regardless of dismissal. */}
      {!sw.waiting && pwa.showLargePrompt && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-[90] max-w-[20rem] rounded-xl border border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-sm text-navy-900 shadow-xl"
        >
          <p className="pr-1">Installer Effitrans sur cet appareil ?</p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={pwa.dismissLargePrompt}
              className="min-h-[36px] rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Plus tard
            </button>
            <button
              type="button"
              onClick={() => void pwa.install()}
              className="min-h-[36px] rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Installer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

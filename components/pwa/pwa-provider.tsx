"use client";

/**
 * PWA runtime (Phase 8.3). CLIENT — mounted once in the root layout, on every surface.
 * ---------------------------------------------------------------------------
 * Three small, independent concerns; none touches business data:
 *
 * 1. SERVICE-WORKER lifecycle — registers /sw.js ONLY when NEXT_PUBLIC_PWA_ENABLED="true"
 *    (dark by default: Preview first, production after acceptance — Phase 8.3 §S). When a new
 *    worker is WAITING, shows a non-disruptive banner; activation happens only on the user's
 *    click (SKIP_WAITING → single guarded reload — never during form entry on its own, never
 *    a refresh loop).
 * 2. INSTALL prompt — captures beforeinstallprompt (Android/desktop), offers install once,
 *    remembers dismissal in localStorage, hides when already installed (standalone). On iOS
 *    (no prompt API) shows manual instructions once. Secondary to operational work by design.
 * 3. NETWORK status — offline banner + reconnection confirmation. navigator.onLine is treated
 *    as a HINT only (it can be true while the backend is unreachable); real requests keep
 *    their real error states — this banner never suppresses or replaces them.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const INSTALL_DISMISSED_KEY = "effitrans.pwa.install.dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

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

// ---------------------------------------------------------------- install prompt ----

function useInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed — never show anything
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
    } catch {
      /* storage unavailable — behave as dismissed to avoid nagging */
      dismissed = true;
    }
    if (dismissed) return;

    if (isIos()) {
      // iOS has no beforeinstallprompt — offer the manual instructions once.
      setShowIosHelp(true);
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    setDeferred(null);
    setShowIosHelp(false);
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    // Whatever the choice, do not re-prompt this session; dismissal state persists.
    dismiss();
  }, [deferred, dismiss]);

  return { canInstall: Boolean(deferred), showIosHelp, install, dismiss };
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
  const inst = useInstall();
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

      {/* Install — one-time, dismissible, secondary. */}
      {!sw.waiting && (inst.canInstall || inst.showIosHelp) && (
        <div role="status" className="fixed inset-x-0 bottom-0 z-[90] flex flex-wrap items-center justify-center gap-3 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-sm text-navy-900 shadow-2xl">
          {inst.canInstall ? (
            <>
              <span>Installer Effitrans sur cet appareil ?</span>
              <button type="button" onClick={inst.install} className="min-h-[44px] rounded-lg bg-navy-900 px-4 py-2 font-semibold text-white">
                Installer
              </button>
            </>
          ) : (
            <span>
              Sur iPhone/iPad : ouvrez le menu Partager <span aria-hidden>⎋</span> puis « Sur l'écran d'accueil » pour installer Effitrans.
            </span>
          )}
          <button type="button" onClick={inst.dismiss} className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-600">
            Plus tard
          </button>
        </div>
      )}
    </div>
  );
}

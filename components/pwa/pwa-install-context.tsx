"use client";

/**
 * PWA install — shared state (Phase 8.5). CLIENT — the ONLY place that listens for
 * `beforeinstallprompt`/`appinstalled` and owns the dismissal timestamp. Mounted once at the
 * root (app/layout.tsx) so every consumer (the compact first-visit banner in PwaProvider, the
 * header action in Topbar, future menu entries in other shells) reads ONE state instead of each
 * attaching its own listener — no competing implementation, no risk of the banner and the
 * header button disagreeing about installability.
 *
 * Dark by default: identical gate to the service worker (NEXT_PUBLIC_PWA_ENABLED="true") — off,
 * no listeners are attached and every consumer sees `available: false`.
 *
 * Stores ONLY a dismissal timestamp under a namespaced key
 * (effitrans:pwa-install-prompt-dismissed) — never a tenant id, user id, email, or session
 * value. See lib/pwa/install-logic.ts for the pure decision rules this wraps.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  PWA_INSTALL_DISMISS_KEY,
  computeStandalone,
  isDismissalActive,
  isIosSafariBrowser,
  parseDismissedAt,
} from "@/lib/pwa/install-logic";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PwaInstallState = {
  /** The compact control (header/menu) should render — installable AND not already installed.
   *  Independent of the large prompt's dismissal: "remains available whenever installable". */
  available: boolean;
  /** The large first-visit prompt should render (available AND not recently dismissed). */
  showLargePrompt: boolean;
  /** True once installed (standalone display OR the appinstalled event fired). */
  installed: boolean;
  /** iOS has no native prompt — install() opens instructions instead of calling prompt(). */
  isIos: boolean;
  /** Trigger installation: native prompt() on Android/desktop, or open the iOS instructions. */
  install: () => Promise<void>;
  /** Dismiss ONLY the large prompt for ~30 days; the compact control stays available. */
  dismissLargePrompt: () => void;
  /** iOS instruction dialog open state, shared so exactly one dialog instance is ever mounted. */
  iosDialogOpen: boolean;
  closeIosDialog: () => void;
};

const PwaInstallContext = createContext<PwaInstallState | null>(null);

export function usePwaInstall(): PwaInstallState {
  const ctx = useContext(PwaInstallContext);
  if (!ctx) {
    // Rendered outside the provider (shouldn't happen — it's mounted at the root). Fail safe:
    // report "nothing available" rather than throw, so a stray import never breaks a page.
    return {
      available: false, showLargePrompt: false, installed: false, isIos: false,
      install: async () => {}, dismissLargePrompt: () => {}, iosDialogOpen: false, closeIosDialog: () => {},
    };
  }
  return ctx;
}

export function PwaInstallProvider({ children }: { children: React.ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [iosDialogOpen, setIosDialogOpen] = useState(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PWA_ENABLED !== "true") return;

    const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    setIsIos(isIosSafariBrowser(navigator.userAgent, touchMac));
    setInstalled(
      computeStandalone(
        window.matchMedia?.("(display-mode: standalone)").matches ?? false,
        (window.navigator as { standalone?: boolean }).standalone,
      ),
    );
    try {
      setDismissedAt(parseDismissedAt(localStorage.getItem(PWA_INSTALL_DISMISS_KEY)));
    } catch {
      /* storage unavailable — treat as never dismissed; the large prompt just shows once more */
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismissLargePrompt = useCallback(() => {
    const now = Date.now();
    setDismissedAt(now);
    try {
      localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(now));
    } catch {
      /* best-effort only */
    }
  }, []);

  const closeIosDialog = useCallback(() => setIosDialogOpen(false), []);

  const install = useCallback(async () => {
    if (isIos) {
      setIosDialogOpen(true);
      return;
    }
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice.catch(() => null);
    } finally {
      // Clear the spent event either way — a BeforeInstallPromptEvent can only be prompted
      // once. A rejection is recoverable: nothing is permanently blocked on our side, the
      // compact control simply waits for the browser to (possibly) fire a fresh event on a
      // later visit — never re-simulated or faked here.
      setDeferred(null);
    }
  }, [deferred, isIos]);

  const available = !installed && (Boolean(deferred) || isIos);
  const showLargePrompt = available && !isDismissalActive(dismissedAt, Date.now());

  const value = useMemo<PwaInstallState>(
    () => ({ available, showLargePrompt, installed, isIos, install, dismissLargePrompt, iosDialogOpen, closeIosDialog }),
    [available, showLargePrompt, installed, isIos, install, dismissLargePrompt, iosDialogOpen, closeIosDialog],
  );

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}

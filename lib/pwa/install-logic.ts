/**
 * PWA install — pure decision logic (Phase 8.3 → 8.5 compact redesign). PURE, no DOM, no
 * "use client" — unit-testable directly. This is the ONLY place that decides:
 *   - is this device/browser iOS, and specifically iOS SAFARI (the only iOS browser that can
 *     actually install a PWA — Chrome/Edge/Firefox on iOS are WebKit wrappers with no
 *     "Add to Home Screen" capability, and the UI must never claim otherwise);
 *   - is the app already running standalone (installed);
 *   - has the large first-visit prompt been dismissed recently enough to stay hidden.
 *
 * `components/pwa/pwa-install-context.tsx` is the ONLY consumer that touches the DOM
 * (navigator/window/localStorage) — it calls these pure functions with the real values.
 */

/** Namespaced, non-identifying — a timestamp only, never tenant/user/session data. */
export const PWA_INSTALL_DISMISS_KEY = "effitrans:pwa-install-prompt-dismissed";

/** How long the LARGE first-visit prompt stays suppressed after "Plus tard". The compact
 *  header action is NOT governed by this — it remains available whenever installable. */
export const INSTALL_DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/** iPhone/iPod always report it in the UA; iPad reports "Macintosh" from iPadOS 13 on, so the
 *  caller additionally passes whether this looks like a touch-capable Mac (maxTouchPoints > 1
 *  on a MacIntel platform is iPadOS's own documented detection trick — no other desktop Mac
 *  reports touch points). */
export function isIosDevice(userAgent: string, isTouchCapableMac = false): boolean {
  return /iphone|ipad|ipod/i.test(userAgent) || isTouchCapableMac;
}

/**
 * True ONLY for Safari on iOS/iPadOS — the one iOS browser with "Ajouter à l'écran d'accueil".
 * Every other iOS browser (Chrome/CriOS, Edge/EdgiOS, Firefox/FxiOS, Opera/OPiOS, etc.) is a
 * WebKit wrapper that cannot install a PWA; the UI must show nothing rather than a broken or
 * misleading action for them.
 */
export function isIosSafariBrowser(userAgent: string, isTouchCapableMac = false): boolean {
  if (!isIosDevice(userAgent, isTouchCapableMac)) return false;
  if (/crios|fxios|edgios|opios|opt\/|duckduckgo|brave|ucbrowser|mercury|gsa\//i.test(userAgent)) return false;
  return /safari/i.test(userAgent);
}

/** Standalone (already installed) from the two platform signals — pure combination. */
export function computeStandalone(displayModeStandaloneMatches: boolean, navigatorStandalone: boolean | undefined): boolean {
  return displayModeStandaloneMatches || navigatorStandalone === true;
}

/** Defensive parse — a corrupted/foreign value is treated as "never dismissed", not a crash. */
export function parseDismissedAt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Is the large prompt still within its 30-day suppression window? */
export function isDismissalActive(dismissedAtMs: number | null, nowMs: number, durationMs = INSTALL_DISMISS_DURATION_MS): boolean {
  if (dismissedAtMs == null) return false;
  return nowMs - dismissedAtMs < durationMs;
}

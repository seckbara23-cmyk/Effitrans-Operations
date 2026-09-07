"use client";

/**
 * APP-NAVIGATION-01 — Back / Forward in the application header.
 * ---------------------------------------------------------------------------
 * RATIFIED 2026-09-07. Effitrans staff work across the dossier, its documents,
 * its official process and their department queue, and the desktop shell offered
 * no way back that did not mean reaching for the browser chrome.
 *
 * ── THIS IS NAVIGATION AND NOTHING ELSE ────────────────────────────────────
 * It calls `router.back()` and `router.forward()`. It never submits a form,
 * never calls a server action, never touches a step, an assignment or a
 * document. Going Back after completing an étape re-renders the previous page;
 * it does not un-complete anything, because there is no mechanism here by which
 * it could — the only two effects this file can have are those two router
 * calls. A test pins that.
 *
 * ── KNOWING WHETHER THERE IS ANYWHERE TO GO ─────────────────────────────────
 * The browser deliberately does not tell a page how much history it has, and
 * `history.length` counts entries from before the app was ever opened. So this
 * keeps its own per-tab trail in `sessionStorage`: the URLs visited, and a
 * cursor into them.
 *
 * The trail is DRIFT-FREE by construction. On every navigation it compares the
 * new URL with its neighbours in the trail:
 *
 *     equals trail[cursor - 1]  →  we went back
 *     equals trail[cursor + 1]  →  we went forward
 *     anything else             →  a new destination; forward history is
 *                                  truncated, exactly as a browser does
 *
 * That holds no matter WHO navigated — these buttons, the keyboard, the
 * browser's own chrome, or a `<Link>` — so the two arrows cannot come to
 * disagree with the browser about where you are. Nothing here calls
 * `history.pushState`, so no artificial entry is invented either.
 *
 * ── KEYBOARD ────────────────────────────────────────────────────────────────
 * Alt+← and Alt+→, as ratified. `preventDefault` is deliberate: those are
 * already the platform's own Back/Forward, and letting both run would move two
 * entries per press. Skipped entirely while the caret is in a field, where the
 * combination belongs to text editing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const KEY = "effitrans.nav.trail";
/** Bounded: a long session must not grow session storage without limit. */
const MAX = 50;

type Trail = { urls: string[]; cursor: number };

function read(): Trail | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Trail;
    if (!Array.isArray(parsed.urls) || typeof parsed.cursor !== "number") return null;
    return parsed;
  } catch {
    // Private browsing, a storage quota, a disabled cookie jar. The arrows
    // simply stay disabled; nothing else on the page depends on this.
    return null;
  }
}

function write(trail: Trail) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(trail));
  } catch {
    /* see read() */
  }
}

/** Where the trail stands after arriving at `url`. PURE — unit-tested. */
export function advance(trail: Trail | null, url: string): Trail {
  if (!trail || trail.urls.length === 0) return { urls: [url], cursor: 0 };
  if (trail.urls[trail.cursor] === url) return trail; // a re-render, not a move
  if (trail.cursor > 0 && trail.urls[trail.cursor - 1] === url) {
    return { ...trail, cursor: trail.cursor - 1 };
  }
  if (trail.cursor < trail.urls.length - 1 && trail.urls[trail.cursor + 1] === url) {
    return { ...trail, cursor: trail.cursor + 1 };
  }
  // A new destination truncates forward history, exactly as a browser does.
  const urls = [...trail.urls.slice(0, trail.cursor + 1), url].slice(-MAX);
  return { urls, cursor: urls.length - 1 };
}

/** Is the caret somewhere the platform's Alt+arrow means something else? */
function editing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function HistoryNav() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<{ back: boolean; forward: boolean }>({
    back: false,
    forward: false,
  });
  const last = useRef<string | null>(null);

  useEffect(() => {
    const qs = search?.toString() ?? "";
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (last.current === url) return;
    last.current = url;
    const trail = advance(read(), url);
    write(trail);
    setState({ back: trail.cursor > 0, forward: trail.cursor < trail.urls.length - 1 });
  }, [pathname, search]);

  const goBack = useCallback(() => router.back(), [router]);
  const goForward = useCallback(() => router.forward(), [router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (editing(e.target)) return;
      if (e.key === "ArrowLeft" && state.back) {
        e.preventDefault();
        goBack();
      } else if (e.key === "ArrowRight" && state.forward) {
        e.preventDefault();
        goForward();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.back, state.forward, goBack, goForward]);

  const cls =
    "rounded-md p-2 text-navy-700 hover:bg-slate-200/60 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent";

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Navigation">
      <button
        type="button"
        onClick={goBack}
        disabled={!state.back}
        aria-label="Précédent (Alt + flèche gauche)"
        title="Précédent — Alt + ←"
        className={cls}
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
          <path d="M12 4 6 10l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={goForward}
        disabled={!state.forward}
        aria-label="Suivant (Alt + flèche droite)"
        title="Suivant — Alt + →"
        className={cls}
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
          <path d="m8 4 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

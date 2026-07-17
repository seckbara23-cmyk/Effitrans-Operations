"use client";

/**
 * Shared dialog/drawer accessibility (Phase 8.3). CLIENT hook — the ONE implementation of
 * modal behavior for every drawer and dialog (no per-component reinvention):
 *
 *   - focus TRAP: Tab/Shift+Tab cycle inside the container;
 *   - Escape closes;
 *   - initial focus moves into the container on open;
 *   - focus RESTORES to the previously-focused element (the trigger) on close;
 *   - body scroll is locked while open.
 *
 * Route-change closing stays the caller's concern (they know their router); everything
 * keyboard/focus/scroll lives here.
 */
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogA11y(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    // Remember the trigger, move focus in.
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    (focusables()[0] ?? container).focus();

    // Lock body scroll.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the trigger.
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  return containerRef;
}

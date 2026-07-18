"use client";

/**
 * Compact PWA install control (Phase 8.5). CLIENT — a small header/menu action, NOT a banner.
 * ---------------------------------------------------------------------------
 * Renders nothing when installation isn't available (flag off, already installed, or the
 * browser exposes no install path — e.g. desktop Firefox, or an iOS browser that isn't
 * Safari): rule 4/9's "do not show a broken action" is satisfied structurally, not by a
 * disabled-looking button.
 *
 * A semantic <button> (never a bare icon — rule 8): "Installer" always visible, the fuller
 * "l'application" suffix shown from `sm:` up so the control stays compact in the topbar at
 * 360px without ever relying on the icon alone for meaning.
 */
import { IconInstall } from "@/lib/icons";
import { usePwaInstall } from "./pwa-install-context";

export function PwaInstallAction({ className = "" }: { className?: string }) {
  const pwa = usePwaInstall();
  if (!pwa.available) return null;

  return (
    <button
      type="button"
      onClick={() => void pwa.install()}
      aria-label="Installer l'application Effitrans sur cet appareil"
      className={
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-navy-700 hover:bg-slate-50 " +
        className
      }
    >
      <IconInstall className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        Installer<span className="hidden sm:inline"> l&apos;application</span>
      </span>
    </button>
  );
}

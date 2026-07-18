"use client";

/**
 * iOS install instructions (Phase 8.5). CLIENT — accessible dialog, ONE instance mounted at
 * the root (app/layout.tsx) regardless of how many PwaInstallAction buttons exist. iOS Safari
 * exposes no `beforeinstallprompt`, so this is the only install path Safari users get; it must
 * never claim Chrome/Edge/Firefox on iOS can do the same (they can't — see install-logic.ts).
 *
 * Reuses the SHARED dialog a11y hook (Phase 8.3, lib/ui/use-dialog-a11y): focus trap, Escape,
 * initial focus, focus restore, body scroll lock — no bespoke modal behavior here.
 */
import { useDialogA11y } from "@/lib/ui/use-dialog-a11y";
import { usePwaInstall } from "./pwa-install-context";

export function PwaInstallIosDialog() {
  const pwa = usePwaInstall();
  const dialogRef = useDialogA11y(pwa.iosDialogOpen, pwa.closeIosDialog);
  if (!pwa.iosDialogOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-ios-install-title"
        aria-describedby="pwa-ios-install-desc"
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 id="pwa-ios-install-title" className="text-base font-semibold text-navy-900">
          Installer sur iPhone / iPad
        </h2>
        <p id="pwa-ios-install-desc" className="mt-2 text-sm text-slate-600">
          Dans Safari, touchez <strong>Partager</strong>, puis « <strong>Ajouter à l&apos;écran d&apos;accueil</strong> ».
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Seul Safari peut installer Effitrans sur iPhone/iPad — Chrome et Edge n&apos;ont pas
          cette fonction sur iOS.
        </p>
        <button
          type="button"
          onClick={pwa.closeIosDialog}
          className="mt-5 min-h-[44px] w-full rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

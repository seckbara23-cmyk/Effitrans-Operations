/**
 * Public offline fallback (Phase 8.3). STATIC — no auth, no data read, tenant-neutral.
 * ---------------------------------------------------------------------------
 * Pre-cached by the service worker at install and served ONLY when a navigation fails
 * because the device is offline. It is deliberately honest: live data is unavailable and
 * NOTHING has been saved — the platform has no offline write queue by design.
 */
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hors ligne" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sand-100 px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl" aria-hidden>
          📡
        </span>
        <h1 className="mt-4 text-xl font-bold text-navy-900">Vous êtes hors ligne</h1>
        <p className="mt-2 text-sm text-slate-600">
          Les données logistiques en direct ne sont pas disponibles sans connexion.
        </p>
        <p className="mt-2 text-sm font-medium text-amber-700">
          Aucune modification n'a été enregistrée — la plateforme n'enregistre jamais de
          changement hors ligne.
        </p>
        <p className="mt-2 text-sm text-slate-600">Reconnectez-vous au réseau pour continuer.</p>
        <a
          href="/"
          className="mt-6 inline-block min-h-[44px] rounded-lg bg-navy-900 px-6 py-2.5 text-sm font-semibold text-white"
        >
          Réessayer
        </a>
      </div>
    </main>
  );
}

/**
 * Public offline fallback (Phase 8.3; recovery added after the 2026-08-09 false-offline
 * incident). STATIC — no auth, no data read, tenant-neutral.
 * ---------------------------------------------------------------------------
 * Pre-cached by the service worker at install and served when a navigation fails at the
 * NETWORK layer twice in a row (sw.js retries once first). Two truths this page owes the
 * user:
 *
 *   1. HONESTY ABOUT STATE — a rejected fetch does not prove the DEVICE is offline
 *      (the incident: « Vous êtes hors ligne » shown on a connected workstation).
 *      navigator.onLine picks the copy — device offline vs service unreachable — as a
 *      HINT only, in both directions.
 *   2. AUTOMATIC RECOVERY — the page probes the real backend (/api/version, no-store,
 *      public + secret-free) every few seconds and on the browser's `online` event.
 *      Only a REAL successful response triggers reload; the `online` event alone is a
 *      trigger to verify, never proof. The fallback document is served UNDER THE
 *      ORIGINAL URL, so reloading retries the page the user actually wanted.
 *
 * The recovery logic is an INLINE script, deliberately: this page's hydration chunks are
 * NOT precached, so a React client component would never hydrate exactly when this page
 * is shown. The inline script travels inside the precached HTML itself. « Réessayer » is
 * an anchor with href="" — reload the current URL — so retry works even with zero JS.
 *
 * Still true, by design: nothing is saved offline — the platform has no offline write
 * queue; live data is never cached.
 */
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hors ligne" };

const RECOVERY_SCRIPT = `
(function () {
  var probing = false;
  function online() { return typeof navigator === "undefined" || navigator.onLine !== false; }
  function setCopy() {
    var t = document.getElementById("offline-title");
    var d = document.getElementById("offline-detail");
    if (t) t.textContent = online()
      ? "Service momentanément injoignable"
      : "Vous êtes hors ligne";
    if (d) d.textContent = online()
      ? "Votre appareil semble connecté, mais la plateforme ne répond pas. Nouvelle tentative automatique en cours…"
      : "Les données logistiques en direct ne sont pas disponibles sans connexion. Reprise automatique dès le retour du réseau.";
  }
  function probe() {
    if (probing) return;
    probing = true;
    fetch("/api/version", { cache: "no-store" })
      .then(function (r) { if (r.ok) { window.location.reload(); } })
      .catch(function () {})
      .then(function () { probing = false; });
  }
  window.addEventListener("online", function () { setCopy(); probe(); });
  window.addEventListener("offline", setCopy);
  setCopy();
  probe();
  setInterval(probe, 4000);
})();
`;

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sand-100 px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl" aria-hidden>
          📡
        </span>
        {/* Pre-script copy covers BOTH states honestly; the script narrows it. */}
        <h1 id="offline-title" className="mt-4 text-xl font-bold text-navy-900">
          Vous êtes hors ligne ou le service est injoignable
        </h1>
        <p id="offline-detail" className="mt-2 text-sm text-slate-600">
          Les données logistiques en direct ne sont pas disponibles pour le moment.
        </p>
        <p className="mt-2 text-sm font-medium text-amber-700">
          Aucune modification n'a été enregistrée — la plateforme n'enregistre jamais de
          changement hors ligne.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Reconnectez-vous au réseau si nécessaire — la page réessaie automatiquement.
        </p>
        {/* href="" reloads the CURRENT url: the fallback is served under the page the
            user wanted, so retry returns THERE — never a detour through "/". */}
        <a
          href=""
          className="mt-6 inline-block min-h-[44px] rounded-lg bg-navy-900 px-6 py-2.5 text-sm font-semibold text-white"
        >
          Réessayer
        </a>
        <script dangerouslySetInnerHTML={{ __html: RECOVERY_SCRIPT }} />
      </div>
    </main>
  );
}

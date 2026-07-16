"use client";

/**
 * Card management studio (DBC-3). CLIENT — administrators only.
 * ---------------------------------------------------------------------------
 * Enable/disable the public card, rotate the token, preview it, and download the QR/vCard.
 * Holds no authority — every action is a gated server action. When the Brand Center is
 * incomplete the card cannot be enabled and the missing items are shown. The token value is
 * never displayed on its own (only inside the public URL the admin manages); it is never
 * logged/audited.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setPublicCard, rotateCardToken, recordCardEvent, type CardResult } from "@/lib/brand/server/card-actions";
import type { CardAdminView } from "@/lib/brand/server/card-service";

export function CardStudio({ userId, view }: { userId: string; view: CardAdminView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [missing, setMissing] = useState<string[] | null>(view.readiness.ready ? null : view.readiness.missing);

  const qrUrl = view.profileUrl ? `${view.profileUrl}/qr.png` : null;
  const vcardUrl = view.profileUrl ? `${view.profileUrl}/vcard` : null;

  function apply(fn: () => Promise<CardResult>, ok: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { setMsg({ tone: "ok", text: ok }); setMissing(null); router.refresh(); }
      else if (res.error === "brand_incomplete") { setMissing(res.missing ?? []); setMsg({ tone: "error", text: "Marque incomplète — publication impossible." }); }
      else setMsg({ tone: "error", text: res.error === "forbidden" ? "Non autorisé." : "Échec." });
    });
  }

  function record(event: "previewed" | "vcard_downloaded" | "qr_downloaded", href: string, newTab = false) {
    start(async () => { await recordCardEvent(userId, event); });
    if (newTab) window.open(href, "_blank", "noopener");
    else window.location.href = href;
  }

  return (
    <div className="space-y-5">
      {!view.readiness.ready && (
        <div className="surface p-5">
          <p className="text-sm font-semibold text-navy-900">Carte non publiable</p>
          <p className="mt-1 text-sm text-slate-600">Complétez ces éléments de marque avant d'activer la carte publique. Aucune valeur n'est substituée.</p>
          <ul className="mt-3 space-y-1">
            {(missing ?? view.readiness.missing).map((m) => (
              <li key={m} className="flex items-center gap-2 text-sm text-slate-700"><span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden />{m}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm"><Link href="/brand-center" className="font-medium text-teal-700 hover:underline">Compléter le Centre de marque →</Link></p>
        </div>
      )}

      <div className="surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-navy-900">Carte publique</p>
            <p className="text-xs text-slate-500">{view.enabled ? "Activée — accessible via le lien ci-dessous." : "Désactivée — le lien renvoie 404."}</p>
          </div>
          <button
            type="button"
            disabled={pending || (!view.enabled && !view.readiness.ready)}
            onClick={() => apply(() => setPublicCard(userId, !view.enabled), view.enabled ? "Carte désactivée." : "Carte activée.")}
            className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${view.enabled ? "border border-slate-200 text-slate-700 hover:bg-slate-50" : "bg-navy-900 text-white hover:bg-navy-800"}`}
          >
            {view.enabled ? "Désactiver" : "Activer"}
          </button>
        </div>

        {view.enabled && view.profileUrl && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Lien public</span>
              <input readOnly value={view.profileUrl} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-navy-800" />
            </label>
            <div className="flex flex-wrap items-center gap-4">
              {qrUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrUrl} alt="Aperçu du QR code de la carte" width={120} height={120} className="rounded border border-slate-200" />
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending} onClick={() => record("previewed", view.profileUrl!, true)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Aperçu</button>
                {vcardUrl && <button type="button" disabled={pending} onClick={() => record("vcard_downloaded", vcardUrl)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Télécharger vCard</button>}
                {qrUrl && <button type="button" disabled={pending} onClick={() => record("qr_downloaded", qrUrl)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Télécharger QR</button>}
                <button type="button" disabled={pending} onClick={() => apply(() => rotateCardToken(userId), "Jeton renouvelé — l'ancien lien est invalide.")} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100">Renouveler le jeton</button>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">Renouveler le jeton change immédiatement le lien et le QR ; l'ancien lien renvoie 404.</p>
          </div>
        )}
        {msg && <p aria-live="polite" className={`mt-3 text-sm font-medium ${msg.tone === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}

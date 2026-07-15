"use client";

/**
 * Brand visual assets (DBC-1). CLIENT.
 * ---------------------------------------------------------------------------
 * Upload (PNG ≤100 KB), list, replace (a new upload of the same kind versions + retires
 * the prior), and retire. Holds no authority; uploadBrandAsset/retireBrandAsset re-check
 * everything server-side and construct the storage path. The client never sees the
 * service role. Alt text is required (accessibility).
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadBrandAsset, retireBrandAsset } from "@/lib/brand/server/actions";
import { ASSET_KINDS, type AssetKind } from "@/lib/brand/model";
import { MAX_ASSET_BYTES } from "@/lib/brand/assets";
import type { BrandAssetView } from "@/lib/brand/server/service";

const KIND_LABEL: Record<AssetKind, string> = {
  LOGO_PRIMARY: "Logo principal", LOGO_REVERSED: "Logo inversé", LOGO_MONOCHROME: "Logo monochrome",
  LOGO_EMAIL_PNG: "Logo e-mail", NETWORK_LOGO: "Logo réseau", EMPLOYEE_PHOTO: "Photo collaborateur",
};
const ERR_FR: Record<string, string> = {
  too_large: "Fichier trop volumineux (max 100 Ko).", not_a_png: "Ce fichier n'est pas un PNG valide.",
  mime_not_allowed: "Format non autorisé (PNG uniquement).", extension_not_allowed: "Extension .png requise.",
  alt_required: "Un texte alternatif est obligatoire.", storage_failed: "Échec du stockage.", forbidden: "Non autorisé.",
};

export function BrandAssetManager({ assets }: { assets: BrandAssetView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<AssetKind>("LOGO_PRIMARY");
  const [alt, setAlt] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const active = assets.filter((a) => a.status === "PUBLISHED");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setStatus({ tone: "error", msg: "Sélectionnez un fichier PNG." }); return; }
    if (!alt.trim()) { setStatus({ tone: "error", msg: ERR_FR.alt_required }); return; }
    if (file.size > MAX_ASSET_BYTES) { setStatus({ tone: "error", msg: ERR_FR.too_large }); return; }
    setStatus(null);
    start(async () => {
      const res = await uploadBrandAsset({ kind, altText: alt.trim(), title: title.trim() || undefined, file });
      if (res.ok) { setStatus({ tone: "ok", msg: "Ressource publiée." }); setAlt(""); setTitle(""); if (fileRef.current) fileRef.current.value = ""; router.refresh(); }
      else setStatus({ tone: "error", msg: ERR_FR[res.error] ?? "Échec." });
    });
  }

  function retire(id: string) {
    start(async () => {
      const res = await retireBrandAsset(id);
      if (res.ok) router.refresh();
      else setStatus({ tone: "error", msg: "Échec du retrait." });
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Téléverser une ressource (PNG, max 100 Ko)</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              {ASSET_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Fichier PNG</span>
            <input ref={fileRef} type="file" accept="image/png" className="w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-2 file:text-white" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Texte alternatif (obligatoire)</span>
            <input value={alt} onChange={(e) => setAlt(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Ex. Logo Effitrans" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Titre (facultatif)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          {status && <p aria-live="polite" className={`text-sm ${status.tone === "ok" ? "text-emerald-600" : "text-red-600"}`}>{status.msg}</p>}
          <button type="submit" disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40">{pending ? "…" : "Publier"}</button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">SVG non accepté : convertissez en PNG approuvé. Publier une ressource du même type crée une nouvelle version et retire la précédente (l'ancienne n'est pas supprimée).</p>
      </form>

      <section className="surface overflow-hidden">
        <header className="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-navy-900">Ressources publiées ({active.length})</header>
        {active.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Aucune ressource publiée.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {active.map((a) => (
              <div key={a.id} className="flex items-center gap-4 p-4">
                <img src={a.publicUrl} alt={a.altText} width={48} height={48} className="h-12 w-12 rounded border border-slate-200 object-contain" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-navy-900">{KIND_LABEL[a.kind]} <span className="text-xs text-slate-400">v{a.version}</span></p>
                  <p className="truncate text-xs text-slate-500">{a.altText} · {(a.bytes / 1024).toFixed(1)} Ko{a.width ? ` · ${a.width}×${a.height}` : ""}</p>
                </div>
                <button type="button" onClick={() => retire(a.id)} disabled={pending} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Retirer</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

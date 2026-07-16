"use client";

/**
 * Presentation studio (DBC-5). CLIENT — administrators only.
 * ---------------------------------------------------------------------------
 * Collects a corporate deck's content, previews the branded slides (server-rendered SVG),
 * and downloads the editable PPTX (server-generated). Holds no authority; generateDeck
 * re-authorizes + renders server-side. If the Brand Center is incomplete, generation is
 * refused with the missing items.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { generateDeck, recordPresentationDownload } from "@/lib/brand/server/presentation-actions";

export function PresentationStudio() {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("Présentation Effitrans");
  const [subtitle, setSubtitle] = useState("");
  const [presenter, setPresenter] = useState("");
  const [agenda, setAgenda] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [bullets, setBullets] = useState("");
  const [slides, setSlides] = useState<string[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [pptx, setPptx] = useState<{ base64: string; filename: string } | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function input() {
    const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
    return {
      presentationType: "CORPORATE" as const, title, subtitle: subtitle || null, presenter: presenter || null,
      agenda: lines(agenda),
      sections: sectionTitle || bullets ? [{ title: sectionTitle || "Présentation", bullets: lines(bullets) }] : undefined,
    };
  }

  function preview() {
    setMsg(null); setMissing(null);
    start(async () => {
      const res = await generateDeck(input(), "preview");
      if (res.ok && res.ready) { setSlides(res.slidesSvg); setIdx(0); setPptx({ base64: res.pptxBase64, filename: res.filename }); }
      else if (res.ok && !res.ready) { setSlides(null); setMissing(res.missing); }
      else setMsg("Aperçu impossible.");
    });
  }

  function download() {
    start(async () => {
      const res = await generateDeck(input(), "generate");
      if (res.ok && res.ready) {
        const bin = atob(res.pptxBase64); const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
        const a = document.createElement("a"); a.href = url; a.download = res.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        await recordPresentationDownload("CORPORATE");
        setMsg("PPTX téléchargé.");
      } else if (res.ok && !res.ready) setMissing(res.missing);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Contenu du deck (CORPORATE)</h2>
        <div className="mt-3 space-y-3">
          <Fld label="Titre"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inp} /></Fld>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Sous-titre"><input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className={inp} /></Fld>
            <Fld label="Présentateur"><input value={presenter} onChange={(e) => setPresenter(e.target.value)} className={inp} /></Fld>
          </div>
          <Fld label="Ordre du jour (une ligne par point)"><textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={4} className={inp} /></Fld>
          <Fld label="Titre de section"><input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} className={inp} /></Fld>
          <Fld label="Points de la section (une ligne par point)"><textarea value={bullets} onChange={(e) => setBullets(e.target.value)} rows={4} className={inp} /></Fld>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={preview} disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40">Aperçu</button>
          <button type="button" onClick={download} disabled={pending || !pptx} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50 disabled:opacity-40">Télécharger PPTX</button>
          {msg && <span aria-live="polite" className="text-xs text-emerald-600">{msg}</span>}
        </div>
        {missing && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Marque incomplète :</p>
            <ul className="mt-1 list-disc pl-5">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
            <Link href="/brand-center" className="mt-1 inline-block font-medium text-teal-700 hover:underline">Compléter le Centre de marque →</Link>
          </div>
        )}
      </section>

      <section className="surface p-3">
        <p className="mb-2 px-2 text-xs text-slate-400">Aperçu des diapositives (SVG indicatif) — le PPTX téléchargé est éditable dans PowerPoint.</p>
        {slides && slides.length ? (
          <div>
            <div className="overflow-hidden rounded-lg border border-slate-200" dangerouslySetInnerHTML={{ __html: slides[idx] }} />
            <div className="mt-2 flex items-center justify-between">
              <button type="button" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="rounded border border-slate-200 px-3 py-1 text-sm disabled:opacity-40">←</button>
              <span className="text-xs text-slate-500">Diapositive {idx + 1} / {slides.length}</span>
              <button type="button" onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))} disabled={idx === slides.length - 1} className="rounded border border-slate-200 px-3 py-1 text-sm disabled:opacity-40">→</button>
            </div>
          </div>
        ) : (
          <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">Cliquez sur « Aperçu »</div>
        )}
      </section>
    </div>
  );
}

const inp = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none";
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}</label>;
}

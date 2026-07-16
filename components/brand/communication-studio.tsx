"use client";

/**
 * Communication studio (DBC-5). CLIENT — administrators only.
 * ---------------------------------------------------------------------------
 * LinkedIn/social masters: pick a kind, enter the headline, preview the branded SVG, and
 * download it. The SVG string IS the artifact (server-generated) — no screenshot. Holds no
 * authority; generateCommunication re-authorizes + renders server-side.
 */
import { useState, useTransition } from "react";
import { generateCommunication } from "@/lib/brand/server/presentation-actions";
import { COMMUNICATION_KINDS, COMMUNICATION_META } from "@/lib/brand/presentation/registry";

export function CommunicationStudio() {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<(typeof COMMUNICATION_KINDS)[number]>("COMPANY_BANNER");
  const [headline, setHeadline] = useState("Effitrans — Performance in Motion");
  const [subline, setSubline] = useState("");
  const [personName, setPersonName] = useState("");
  const [personTitle, setPersonTitle] = useState("");
  const [svg, setSvg] = useState<string | null>(null);
  const [filename, setFilename] = useState("banner.svg");
  const [missing, setMissing] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function run(intent: "preview" | "generate") {
    setMsg(null); setMissing(null);
    start(async () => {
      const res = await generateCommunication({ kind, headline, subline: subline || null, personName: personName || null, personTitle: personTitle || null, intent });
      if (res.ok && res.ready) {
        setSvg(res.svg); setFilename(res.filename);
        if (intent === "generate") {
          const url = URL.createObjectURL(new Blob([res.svg], { type: "image/svg+xml" }));
          const a = document.createElement("a"); a.href = url; a.download = res.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          setMsg("SVG téléchargé.");
        }
      } else if (res.ok && !res.ready) { setSvg(null); setMissing(res.missing); }
      else setMsg("Génération impossible.");
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Modèle de communication</h2>
        <div className="mt-3 space-y-3">
          <Fld label="Type">
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inp}>
              {COMMUNICATION_KINDS.map((k) => <option key={k} value={k}>{COMMUNICATION_META[k].label} ({COMMUNICATION_META[k].width}×{COMMUNICATION_META[k].height})</option>)}
            </select>
          </Fld>
          <Fld label="Titre"><input value={headline} onChange={(e) => setHeadline(e.target.value)} className={inp} /></Fld>
          <Fld label="Sous-titre"><input value={subline} onChange={(e) => setSubline(e.target.value)} className={inp} /></Fld>
          {kind === "CEO_BANNER" && (
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Nom"><input value={personName} onChange={(e) => setPersonName(e.target.value)} className={inp} /></Fld>
              <Fld label="Fonction"><input value={personTitle} onChange={(e) => setPersonTitle(e.target.value)} className={inp} /></Fld>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => run("preview")} disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40">Aperçu</button>
          <button type="button" onClick={() => run("generate")} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Télécharger SVG</button>
          {msg && <span aria-live="polite" className="text-xs text-emerald-600">{msg}</span>}
        </div>
        {missing && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Marque incomplète : {missing.join(", ")}.</p>
          </div>
        )}
      </section>

      <section className="surface p-3">
        <p className="mb-2 px-2 text-xs text-slate-400">Aperçu (SVG) — {COMMUNICATION_META[kind].width}×{COMMUNICATION_META[kind].height}. Le SVG téléchargé est le modèle approuvé.</p>
        {svg ? (
          <div className="overflow-hidden rounded-lg border border-slate-200" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">Cliquez sur « Aperçu »</div>
        )}
      </section>
    </div>
  );
}

const inp = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none";
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}</label>;
}

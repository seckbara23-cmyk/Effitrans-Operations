"use client";

/**
 * Marketing email studio (DBC-6). CLIENT — administrators only.
 * ---------------------------------------------------------------------------
 * Composes a portable marketing email, previews the server-compiled HTML, and copies /
 * downloads it for the chosen ESP. Holds no authority; generateMarketingEmail re-authorizes
 * + compiles server-side. No sending, no scheduling. Incomplete brand → refused.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { generateMarketingEmail } from "@/lib/brand/server/marketing-actions";
import { ACTIVE_MARKETING, MARKETING_LABEL, EMAIL_PROVIDERS, PROVIDER_LABEL, type EmailProvider } from "@/lib/brand/marketing/registry";

export function MarketingStudio() {
  const [pending, start] = useTransition();
  const [type, setType] = useState(ACTIVE_MARKETING[0]);
  const [provider, setProvider] = useState<EmailProvider>("generic");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [headline, setHeadline] = useState("");
  const [paras, setParas] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [filename, setFilename] = useState("email.html");
  const [missing, setMissing] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function input() {
    return {
      type, subject, preheader: preheader || null, headline,
      paragraphs: paras.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
      cta: ctaLabel && ctaUrl ? { label: ctaLabel, url: ctaUrl } : null,
    };
  }

  function run(intent: "preview" | "generate") {
    setMsg(null); setMissing(null);
    start(async () => {
      const res = await generateMarketingEmail({ input: input(), provider, intent });
      if (res.ok && res.ready) {
        setHtml(res.html); setFilename(res.filename);
        if (intent === "generate") {
          const url = URL.createObjectURL(new Blob([res.html], { type: "text/html;charset=utf-8" }));
          const a = document.createElement("a"); a.href = url; a.download = res.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          setMsg("HTML téléchargé.");
        }
      } else if (res.ok && !res.ready) { setHtml(null); setMissing(res.missing); }
      else setMsg("Génération impossible.");
    });
  }

  async function copy() {
    if (!html) return;
    try { await navigator.clipboard.writeText(html); setMsg("HTML copié."); } catch { setMsg("Copie impossible."); }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Composition</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fld label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className={inp}>
              {ACTIVE_MARKETING.map((t) => <option key={t} value={t}>{MARKETING_LABEL[t]}</option>)}
            </select>
          </Fld>
          <Fld label="Plateforme (fusion)">
            <select value={provider} onChange={(e) => setProvider(e.target.value as EmailProvider)} className={inp}>
              {EMAIL_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
            </select>
          </Fld>
          <Fld label="Objet"><input value={subject} onChange={(e) => setSubject(e.target.value)} className={inp} /></Fld>
          <Fld label="Pré-en-tête"><input value={preheader} onChange={(e) => setPreheader(e.target.value)} className={inp} /></Fld>
        </div>
        <Fld label="Titre"><input value={headline} onChange={(e) => setHeadline(e.target.value)} className={inp} /></Fld>
        <Fld label="Corps (paragraphes séparés par une ligne vide)"><textarea value={paras} onChange={(e) => setParas(e.target.value)} rows={6} className={inp} /></Fld>
        <div className="grid grid-cols-2 gap-3">
          <Fld label="Bouton — libellé"><input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} className={inp} /></Fld>
          <Fld label="Bouton — URL"><input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} className={inp} placeholder="https://…" /></Fld>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Balise de personnalisation : <code>{"{{FIRST_NAME}}"}</code> est insérée automatiquement et traduite pour la plateforme choisie.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => run("preview")} disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40">Aperçu</button>
          <button type="button" onClick={copy} disabled={pending || !html} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50 disabled:opacity-40">Copier HTML</button>
          <button type="button" onClick={() => run("generate")} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Télécharger HTML</button>
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
        <p className="mb-2 px-2 text-xs text-slate-400">Aperçu HTML — compatible Mailchimp / HubSpot / Dynamics. Rendu indicatif.</p>
        {html ? (
          <iframe title="Aperçu e-mail marketing" srcDoc={html} style={{ width: "100%", height: 560, border: "1px solid #e2e8f0", borderRadius: 8 }} />
        ) : (
          <div className="flex h-[560px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">Cliquez sur « Aperçu »</div>
        )}
      </section>
    </div>
  );
}

const inp = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none";
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mt-3 block first:mt-0"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}</label>;
}

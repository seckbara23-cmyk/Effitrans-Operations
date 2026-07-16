"use client";

/**
 * Corporate document studio (DBC-4). CLIENT — administrators only.
 * ---------------------------------------------------------------------------
 * Collects the document data for a template, then previews the SERVER-rendered PDF and
 * downloads PDF/DOCX. Holds no authority: generateCorporateDocument re-authorizes,
 * re-resolves branding, and renders server-side (React never renders the artifact). If the
 * Brand Center is incomplete, generation is refused with the missing items.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { generateCorporateDocument, recordDocumentDownload, type DocFormat, type DocGenResult } from "@/lib/brand/server/document-actions";
import type { DocumentTemplate } from "@/lib/brand/document/registry";
import type { DocumentInput, DocLineItem, DocSection } from "@/lib/brand/document/model";

type Person = { userId: string; name: string };

export function DocumentStudio({ template, people, today }: { template: DocumentTemplate; people: Person[]; today: string }) {
  const [pending, start] = useTransition();
  const [pdf, setPdf] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [title, setTitle] = useState(template.label);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [signatureUserId, setSignatureUserId] = useState("");
  const [compliance, setCompliance] = useState(true);
  const [paragraphs, setParagraphs] = useState("");
  const [currency, setCurrency] = useState("XOF");
  const [lines, setLines] = useState<DocLineItem[]>([{ description: "", quantity: 1, unitPrice: 0 }]);
  const [sections, setSections] = useState<DocSection[]>([{ heading: "", text: "" }]);

  function buildInput(): DocumentInput {
    const base: DocumentInput = {
      type: template.type, title, number: number || null, date, reference: reference || null,
      client: template.hasClient && clientName ? { name: clientName, address: clientAddress || null } : null,
    };
    if (template.shape === "paragraphs") base.paragraphs = paragraphs.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (template.shape === "line_items") { base.lines = lines.filter((l) => l.description.trim()); base.currency = currency; }
    if (template.shape === "sections") base.sections = sections.filter((s) => s.heading.trim() || s.text.trim());
    return base;
  }

  async function run(format: DocFormat, intent: "preview" | "generate"): Promise<DocGenResult> {
    return generateCorporateDocument({
      input: buildInput(), format, intent,
      signatureUserId: template.allowsSignature && signatureUserId ? signatureUserId : null,
      complianceEnabled: compliance,
    });
  }

  function preview() {
    setMsg(null); setMissing(null); setPdf(null);
    start(async () => {
      const res = await run("pdf", "preview");
      if (res.ok && res.ready) setPdf(`data:application/pdf;base64,${res.base64}`);
      else if (res.ok && !res.ready) setMissing(res.missing);
      else setMsg("Aperçu impossible.");
    });
  }

  function download(format: DocFormat) {
    setMsg(null); setMissing(null);
    start(async () => {
      const res = await run(format, "generate");
      if (res.ok && res.ready) {
        const bin = atob(res.base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([arr], { type: res.mime }));
        const a = document.createElement("a"); a.href = url; a.download = res.filename;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        await recordDocumentDownload(template.type, format);
        setMsg(`${format.toUpperCase()} téléchargé.`);
      } else if (res.ok && !res.ready) setMissing(res.missing);
      else setMsg("Génération impossible.");
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Contenu du document</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fld label="Titre"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inp} /></Fld>
          <Fld label="Numéro"><input value={number} onChange={(e) => setNumber(e.target.value)} className={inp} /></Fld>
          <Fld label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} /></Fld>
          <Fld label="Référence"><input value={reference} onChange={(e) => setReference(e.target.value)} className={inp} /></Fld>
        </div>

        {template.hasClient && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fld label="Client / destinataire"><input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inp} /></Fld>
            <Fld label="Adresse client"><input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className={inp} /></Fld>
          </div>
        )}

        {template.shape === "paragraphs" && (
          <Fld label="Corps (séparez les paragraphes par une ligne vide)"><textarea value={paragraphs} onChange={(e) => setParagraphs(e.target.value)} rows={6} className={inp} /></Fld>
        )}

        {template.shape === "line_items" && (
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-slate-600">Lignes</span>
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-20 rounded border border-slate-200 px-2 py-1 text-xs" aria-label="Devise" />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="mb-2 grid grid-cols-12 gap-2">
                <input placeholder="Description" value={l.description} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} className={`${inp} col-span-6`} />
                <input type="number" placeholder="Qté" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) || 0 } : x))} className={`${inp} col-span-2`} />
                <input type="number" placeholder="P.U." value={l.unitPrice} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, unitPrice: Number(e.target.value) || 0 } : x))} className={`${inp} col-span-3`} />
                <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="col-span-1 text-slate-400 hover:text-red-600" aria-label="Supprimer la ligne">×</button>
              </div>
            ))}
            <button type="button" onClick={() => setLines([...lines, { description: "", quantity: 1, unitPrice: 0 }])} className="text-xs font-medium text-teal-700 hover:underline">+ Ajouter une ligne</button>
          </div>
        )}

        {template.shape === "sections" && (
          <div className="mt-3">
            {sections.map((s, i) => (
              <div key={i} className="mb-3 rounded-lg border border-slate-200 p-3">
                <input placeholder="Titre de section" value={s.heading} onChange={(e) => setSections(sections.map((x, j) => j === i ? { ...x, heading: e.target.value } : x))} className={`${inp} mb-2`} />
                <textarea placeholder="Contenu" value={s.text} onChange={(e) => setSections(sections.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} rows={3} className={inp} />
              </div>
            ))}
            <button type="button" onClick={() => setSections([...sections, { heading: "", text: "" }])} className="text-xs font-medium text-teal-700 hover:underline">+ Ajouter une section</button>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {template.allowsSignature && (
            <Fld label="Signature (collaborateur)">
              <select value={signatureUserId} onChange={(e) => setSignatureUserId(e.target.value)} className={inp}>
                <option value="">— Aucune —</option>
                {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              </select>
            </Fld>
          )}
          <label className="flex items-center gap-2 self-end text-sm text-slate-700">
            <input type="checkbox" checked={compliance} onChange={(e) => setCompliance(e.target.checked)} /> Inclure le bloc conformité
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={preview} disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40">Aperçu</button>
          <button type="button" onClick={() => download("pdf")} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Télécharger PDF</button>
          <button type="button" onClick={() => download("docx")} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Télécharger DOCX</button>
          {msg && <span aria-live="polite" className="text-xs text-emerald-600">{msg}</span>}
        </div>

        {missing && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Marque incomplète — génération impossible :</p>
            <ul className="mt-1 list-disc pl-5">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
            <Link href="/brand-center" className="mt-1 inline-block font-medium text-teal-700 hover:underline">Compléter le Centre de marque →</Link>
          </div>
        )}
      </section>

      <section className="surface p-3">
        <p className="mb-2 px-2 text-xs text-slate-400">Aperçu A4 (PDF) — en-tête, pied de page, marges, couleurs et numérotation de la marque.</p>
        {pdf ? (
          <iframe title="Aperçu du document" src={pdf} style={{ width: "100%", height: 620, border: "1px solid #e2e8f0", borderRadius: 8 }} />
        ) : (
          <div className="flex h-[620px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">Cliquez sur « Aperçu » pour générer</div>
        )}
      </section>
    </div>
  );
}

const inp = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none";
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}</label>;
}

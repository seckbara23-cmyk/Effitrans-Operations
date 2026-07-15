"use client";

/**
 * Signature Preview Studio (DBC-2). CLIENT.
 * ---------------------------------------------------------------------------
 * Displays the SERVER-compiled signature (never generates it) and lets the admin preview
 * it at different widths / client approximations / modes, then Generate, Download and Copy
 * the exact server output. The preview is informational — it never claims pixel-perfect
 * rendering. If the Brand Center is incomplete, generation is refused and the missing items
 * are shown. Holds no authority; all actions are server-gated.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { compileEmployeeSignature, recordSignatureEvent, type SignatureResult } from "@/lib/brand/server/signature-actions";

type Ready = Extract<SignatureResult, { ready: true }>;

const DEVICES = [{ k: "desktop", label: "Bureau", w: 640 }, { k: "mobile", label: "Mobile", w: 360 }] as const;
const CLIENTS = [
  { k: "outlook", label: "Outlook (approx.)", font: "Calibri, Arial, sans-serif" },
  { k: "gmail", label: "Gmail (approx.)", font: "Arial, sans-serif" },
  { k: "apple", label: "Apple Mail (approx.)", font: "-apple-system, Helvetica, Arial, sans-serif" },
] as const;

export function SignatureStudio({ userId, employeeName, variant, initial }: {
  userId: string; employeeName: string; variant: string; initial: SignatureResult;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SignatureResult>(initial);
  const [device, setDevice] = useState<(typeof DEVICES)[number]>(DEVICES[0]);
  const [client, setClient] = useState<(typeof CLIENTS)[number]>(CLIENTS[0]);
  const [dark, setDark] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  const ready = result.ok && "ready" in result && result.ready ? (result as Ready) : null;

  function regenerate(intent: "preview" | "generate") {
    start(async () => {
      const r = await compileEmployeeSignature(userId, intent);
      setResult(r);
      if (r.ok && "ready" in r && r.ready && intent === "generate") setMsg("Signature générée.");
    });
  }

  function download(format: "html" | "text") {
    if (!ready) return;
    const content = format === "html" ? ready.html : ready.text;
    const blob = new Blob([content], { type: format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Signature-${variant}.${format === "html" ? "html" : "txt"}`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    start(async () => { await recordSignatureEvent(userId, "downloaded", format); });
    setMsg(`${format === "html" ? "HTML" : "Texte"} téléchargé.`);
  }

  async function copy(format: "html" | "text") {
    if (!ready) return;
    try {
      if (format === "html" && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([ready.html], { type: "text/html" }),
          "text/plain": new Blob([ready.text], { type: "text/plain" }),
        })]);
      } else {
        await navigator.clipboard.writeText(format === "html" ? ready.html : ready.text);
      }
      setMsg(`${format === "html" ? "HTML" : "Texte"} copié.`);
      start(async () => { await recordSignatureEvent(userId, "copied", format); });
    } catch { setMsg("Copie impossible dans ce navigateur."); }
  }

  // Not ready → show the honest gating panel.
  if (result.ok && "ready" in result && !result.ready) {
    return (
      <div className="surface p-5">
        <p className="text-sm font-semibold text-navy-900">Signature non publiable pour l'instant</p>
        <p className="mt-1 text-sm text-slate-600">Les éléments de marque suivants sont requis avant de générer une signature de production. Aucune valeur n'est substituée automatiquement.</p>
        <ul className="mt-3 space-y-1">
          {result.missing.map((m) => (
            <li key={m} className="flex items-center gap-2 text-sm text-slate-700"><span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden />{m}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm"><Link href="/brand-center" className="font-medium text-teal-700 hover:underline">Compléter le Centre de marque →</Link></p>
      </div>
    );
  }
  if (!result.ok || !ready) {
    return <div className="surface p-5 text-sm text-red-600">Impossible de préparer la signature ({result.ok ? "état" : result.error}).</div>;
  }

  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:16px;background:${dark ? "#1f2937" : "#ffffff"};font-family:${client.font}">${ready.html}</body></html>`;

  return (
    <div className="space-y-4">
      <div className="surface flex flex-wrap items-center gap-3 p-3">
        <Toggle label="Appareil" options={DEVICES.map((x) => ({ k: x.k, label: x.label }))} value={device.k} on={(k) => setDevice(DEVICES.find((x) => x.k === k)!)} />
        <Toggle label="Client" options={CLIENTS.map((x) => ({ k: x.k, label: x.label }))} value={client.k} on={(k) => setClient(CLIENTS.find((x) => x.k === k)!)} />
        <button type="button" onClick={() => setDark((v) => !v)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">{dark ? "Clair" : "Sombre (approx.)"}</button>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="rounded border border-slate-200 px-2 py-1">−</button>
          <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(1.5, z + 0.25))} className="rounded border border-slate-200 px-2 py-1">+</button>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">Aperçu <strong>indicatif</strong> — le rendu réel varie selon le client de messagerie ; aucune compatibilité pixel-perfect n'est garantie.</p>

      <div className="surface overflow-auto p-4">
        <div style={{ width: device.w * zoom, maxWidth: "100%" }}>
          <iframe title={`Aperçu signature ${employeeName}`} srcDoc={doc} style={{ width: device.w, height: 420, border: "1px solid #e2e8f0", transform: `scale(${zoom})`, transformOrigin: "top left" }} />
        </div>
      </div>

      <div className="surface flex flex-wrap items-center gap-2 p-3">
        <button type="button" onClick={() => regenerate("generate")} disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40">Générer</button>
        <button type="button" onClick={() => download("html")} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Télécharger HTML</button>
        <button type="button" onClick={() => copy("html")} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Copier HTML</button>
        <button type="button" onClick={() => download("text")} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Télécharger texte</button>
        <button type="button" onClick={() => copy("text")} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-800 hover:bg-slate-50">Copier texte</button>
        <Link href="/brand-center/guides" className="ml-auto text-sm text-teal-700 hover:underline">Guides d'installation</Link>
        {msg && <span aria-live="polite" className="w-full text-xs text-emerald-600">{msg}</span>}
      </div>
    </div>
  );
}

function Toggle({ label, options, value, on }: { label: string; options: { k: string; label: string }[]; value: string; on: (k: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <div className="flex overflow-hidden rounded-md border border-slate-200">
        {options.map((o) => (
          <button key={o.k} type="button" onClick={() => on(o.k)} className={`px-2.5 py-1 text-xs ${value === o.k ? "bg-navy-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

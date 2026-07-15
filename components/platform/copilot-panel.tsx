"use client";

/**
 * Platform Copilot panel (Phase 6.0F). CLIENT.
 * ---------------------------------------------------------------------------
 * Read-only operator Q&A over safe tenant aggregates. It NEVER calls an AI provider
 * directly — it POSTs to /api/platform/copilot, which authorizes, builds the allowlisted
 * context, and runs the shared engine. The answer is shown as plain text with a freshness
 * caveat and a source-tenant count; suggested questions seed common operator queries.
 */
import { useRef, useState } from "react";

const SUGGESTIONS = [
  "Quels tenants sont encore en onboarding ?",
  "Quels tenants ont un essai expiré ?",
  "Quels tenants sont suspendus ou archivés ?",
  "Quels tenants n'ont aucun déploiement actif ?",
  "Quels tenants ont une marque incomplète ?",
  "Quels tenants n'ont aucune activité récente ?",
  "Quels tenants demandent l'attention d'un opérateur ?",
];

type Meta = { tenantCount: number; generatedAt: string; categories: string[] };

export function PlatformCopilotPanel() {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || pending) return;
    setPending(true);
    setError(null);
    setAnswer(null);
    setMeta(null);
    try {
      const res = await fetch("/api/platform/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question }),
      });
      const data = (await res.json().catch(() => null)) as { text?: string; meta?: Meta; error?: string } | null;
      if (!res.ok || !data?.text) {
        setError(data?.error ?? "Le copilote n'a pas pu répondre.");
      } else {
        setAnswer(data.text);
        setMeta(data.meta ?? null);
      }
    } catch {
      setError("Réseau indisponible. Réessayez.");
    } finally {
      setPending(false);
      statusRef.current?.focus();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => {
              setPrompt(s);
              ask(s);
            }}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(prompt);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="pf-copilot" className="sr-only">
          Question à propos des tenants
        </label>
        <input
          id="pf-copilot"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Posez une question sur l'état des tenants…"
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white focus:border-teal-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !prompt.trim()}
          className="rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-navy-950 hover:bg-teal-400 disabled:opacity-40"
        >
          {pending ? "…" : "Demander"}
        </button>
      </form>

      <div ref={statusRef} tabIndex={-1} aria-live="polite" className="outline-none">
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
        )}
        {answer && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{answer}</p>
            {meta && (
              <p className="mt-4 border-t border-white/10 pt-3 text-[11px] text-slate-500">
                Source : {meta.tenantCount} tenant(s) · instantané du {meta.generatedAt.slice(0, 16).replace("T", " ")} ·
                lecture seule, agrégats sûrs. Pour agir, ouvrez la fiche de l'entreprise concernée.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

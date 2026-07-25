"use client";

/**
 * Operations Copilot panel (Phase 10.0F-2). CLIENT — compact, read-only.
 * ---------------------------------------------------------------------------
 * It NEVER calls an AI provider directly and holds NO business logic: it POSTs a
 * plain question to /api/operations/copilot (which authorizes, builds the bounded
 * permission-shaped context, calls the shared engine and degrades to a
 * deterministic answer). Stateless by design — the last answer lives only in
 * component state for the current page session (no history, no persistence). The
 * answer renders as SAFE PLAIN TEXT (whitespace-preserved) — never HTML, never a
 * model-generated link. It loads interactively and never blocks the cockpit.
 */
import { useState } from "react";
import { CockpitSectionShell } from "./cockpit-section-shell";

const SUGGESTIONS = [
  "Que faut-il traiter en priorité aujourd'hui ?",
  "Résumez les opérations du jour.",
  "Quels dossiers nécessitent une intervention ?",
  "Quels blocages financiers affectent les opérations ?",
  "Quels problèmes douaniers nécessitent une action ?",
  "Quelles livraisons sont en retard ?",
];
const MAX_QUESTION = 2000;

type Answer = { text: string; usedFallback: boolean; generatedAt: string };

export function OperationsCopilotPanel() {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await fetch("/api/operations/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text.slice(0, MAX_QUESTION) }),
      });
      const data = (await r.json().catch(() => null)) as (Partial<Answer> & { answer?: string; error?: string }) | null;
      if (!r.ok || !data?.answer) {
        setError(data?.error ?? "Le copilote n'a pas pu répondre.");
      } else {
        setAnswer({ text: data.answer, usedFallback: Boolean(data.usedFallback), generatedAt: data.generatedAt ?? "" });
      }
    } catch {
      setError("Réseau indisponible. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <CockpitSectionShell
      title="Copilote des opérations"
      subtitle="Assistant en lecture seule — posez une question sur les opérations du jour."
    >
      <div className="surface space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setQuestion(s); ask(s); }}
              disabled={pending}
              className="rounded-full border border-slate-200 bg-sand-50/60 px-3 py-1 text-xs font-medium text-navy-800 transition hover:border-teal-300 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); ask(question); }} className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION))}
            maxLength={MAX_QUESTION}
            placeholder="Votre question…"
            aria-label="Question au copilote des opérations"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending || !question.trim()}
            className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {pending ? "…" : "Demander"}
          </button>
        </form>

        {pending && (
          <p role="status" className="text-sm text-slate-500">
            Analyse des opérations en cours…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {answer && !pending && (
          <div className="rounded-lg border border-slate-100 bg-sand-50/40 p-3">
            {answer.usedFallback && (
              <p className="mb-1 text-[11px] font-medium text-amber-600">
                Réponse déterministe (assistant IA momentanément indisponible).
              </p>
            )}
            {/* SAFE plain text — whitespace preserved; no HTML, no markdown, no model-generated links. */}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy-900">{answer.text}</p>
          </div>
        )}
      </div>
    </CockpitSectionShell>
  );
}

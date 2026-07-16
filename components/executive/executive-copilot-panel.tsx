"use client";

/**
 * Executive Copilot panel (Phase 7.7). CLIENT.
 * ---------------------------------------------------------------------------
 * Read-only executive assistant. It NEVER calls an AI provider directly — it POSTs to
 * /api/executive/copilot, which authorizes, reuses the request-cached executive snapshot, computes
 * DETERMINISTIC cards, and asks the shared engine (with a deterministic fallback, so this panel
 * always answers).
 *
 * Mirrors the Logistics Copilot panel's conversational UX: SESSION-ONLY history (React state; lost
 * on refresh; no DB, no localStorage), suggested prompts, evidence drill-downs, export. No provider
 * call happens on mount — the assistant only runs on an explicit question.
 */
import { useState } from "react";
import type { ExecRecommendationCard } from "@/lib/executive/copilot/types";

type Meta = { generatedAt: string; sections: string[]; unavailable: string[] };
type Answer = { text: string; cards: ExecRecommendationCard[]; fallback: boolean; meta: Meta; notice?: string };
type Turn = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Quelle est la situation de l'entreprise aujourd'hui ?",
  "Où sont nos goulots d'étranglement ?",
  "Quel est notre risque de recouvrement ?",
  "La douane ralentit-elle nos livraisons ?",
  "Quels clients concentrent l'encours échu ?",
  "L'assistance IA fonctionne-t-elle correctement ?",
];
const CONF_TONE: Record<string, string> = { HIGH: "bg-teal-50 text-teal-700", MEDIUM: "bg-amber-50 text-amber-700", LOW: "bg-slate-100 text-slate-500" };
const MAX_TURNS = 12;

export function ExecutiveCopilotPanel() {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [res, setRes] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]); // SESSION-ONLY (no persistence)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  async function ask(q: string) {
    const question = q.trim();
    if (!question || pending) return;
    setPending(true);
    setError(null);
    setExpanded({});
    const history = turns.slice(-MAX_TURNS);
    try {
      const r = await fetch("/api/executive/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question, history }),
      });
      const data = (await r.json().catch(() => null)) as (Answer & { error?: string }) | null;
      if (!r.ok || !data?.text) setError(data?.error ?? "L'assistant n'a pas pu répondre.");
      else {
        setRes(data);
        setTurns((p) => [...p, { role: "user" as const, content: question }, { role: "assistant" as const, content: data.text }].slice(-MAX_TURNS));
        setPrompt("");
      }
    } catch {
      setError("Réseau indisponible. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  function newConversation() {
    setTurns([]); setRes(null); setError(null); setPrompt(""); setExpanded({});
  }

  function exportText(format: "copy" | "text") {
    if (!res) return;
    const text = [
      res.text, "",
      ...(res.cards.length ? ["Points d'attention :"] : []),
      ...res.cards.map((c) => `- ${c.title} (${c.confidence}) — ${c.finding}` + c.evidence.slice(0, 8).map((e) => `\n    · ${e.label}: ${e.value ?? "—"}`).join("")),
    ].join("\n");
    if (format === "copy") navigator.clipboard?.writeText(text).catch(() => {});
    else {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `synthese-executive-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  return (
    <section className="surface p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden>🧠</span>
        <h2 className="text-sm font-semibold text-navy-900">Assistant exécutif</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Lecture seule · recommandations</span>
        {turns.length > 0 && (
          <button type="button" onClick={newConversation} className="ml-auto rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">
            Nouvelle conversation
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => ask(s)} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-teal-300 disabled:opacity-40">
            {s}
          </button>
        ))}
      </div>

      {turns.length > 0 && (
        <ul className="mb-3 space-y-1.5 border-l-2 border-slate-100 pl-3">
          {turns.slice(-6).map((t, i) => (
            <li key={i} className={`text-xs ${t.role === "user" ? "font-medium text-navy-800" : "text-slate-600"}`}>
              <span className="text-slate-400">{t.role === "user" ? "Vous" : "Assistant"} : </span>
              {t.content.length > 220 ? t.content.slice(0, 220) + "…" : t.content}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => { e.preventDefault(); ask(prompt); }} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="exec-copilot" className="sr-only">Question exécutive</label>
        <input id="exec-copilot" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Posez une question sur la performance de l'entreprise…" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
        <button type="submit" disabled={pending || !prompt.trim()} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {pending ? "…" : "Demander"}
        </button>
      </form>

      <div aria-live="polite" className="mt-3">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {res && (
          <div className="space-y-3">
            {res.notice && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">⚠ {res.notice} — synthèse déterministe affichée (aucun chiffre inventé).</div>}

            <div className="rounded-xl border border-slate-200 bg-sand-50/60 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy-900">{res.text}</p>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                <button type="button" onClick={() => exportText("copy")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">Copier</button>
                <button type="button" onClick={() => exportText("text")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">Télécharger (.txt)</button>
              </div>
            </div>

            {res.cards.length > 0 && (
              <ul className="space-y-2">
                {res.cards.map((c, i) => (
                  <li key={`${c.kind}-${i}`} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-navy-900">{c.title}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CONF_TONE[c.confidence] ?? "bg-slate-100 text-slate-500"}`}>Confiance {c.confidence}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{c.finding}</p>
                    <p className="mt-1 text-xs text-slate-500">{c.reasoning}</p>
                    <p className="mt-2 text-xs font-medium text-navy-700">Action suggérée : <span className="font-normal text-slate-600">{c.suggestedAction}</span></p>
                    {c.evidence.length > 0 && (
                      <button type="button" onClick={() => setExpanded((p) => ({ ...p, [i]: !p[i] }))} className="mt-2 text-[11px] font-medium text-teal-700 hover:underline">
                        {expanded[i] ? "Masquer" : "Voir"} les chiffres ({c.evidence.length})
                      </button>
                    )}
                    {expanded[i] && (
                      <ul className="mt-1 space-y-0.5 border-l-2 border-slate-100 pl-2">
                        {c.evidence.slice(0, 12).map((e, j) => (
                          <li key={j} className="text-xs text-slate-600">
                            {e.href ? <a href={e.href} className="font-medium text-teal-700 hover:underline">{e.label}</a> : <span className="font-medium text-navy-800">{e.label}</span>}
                            <span className="ml-1 tabular text-navy-800">{e.value ?? "—"}</span>
                            {e.detail && <span className="ml-1 text-slate-400">· {e.detail}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <p className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
              Lecture seule · instantané du {res.meta.generatedAt.slice(0, 16).replace("T", " ")}
              {res.meta.unavailable.length > 0 && ` · sections non incluses : ${res.meta.unavailable.join(", ")}`}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

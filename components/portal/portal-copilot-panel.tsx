"use client";

/**
 * Customer AI Assistant panel (Phase 7.6C). CLIENT.
 * ---------------------------------------------------------------------------
 * Replaces the Phase 3.3 "Assistant Effitrans — Bientôt" placeholder with the real assistant.
 * It NEVER calls an AI provider directly — it POSTs to /api/portal/copilot, which authorizes the
 * PORTAL identity, builds the bounded read-only customer context, computes DETERMINISTIC cards,
 * and asks the shared engine (with a deterministic fallback, so this panel always answers).
 *
 * Mirrors the Logistics Copilot panel's conversational UX — SESSION-ONLY history (React state:
 * lost on refresh; no DB, no localStorage, no cookie), suggested prompts, inline conversation,
 * copy/download export, and the fallback notice — minus every internal surface: no module filter,
 * no confidence badge, no evidence-vs-reasoning split naming internal systems, and NO usage strip
 * (a customer never sees provider/model/token/latency diagnostics).
 *
 * No provider call happens on mount: the assistant only runs on an explicit question.
 */
import { useState } from "react";
import type { PortalRecommendationCard } from "@/lib/portal/copilot/types";
import { t } from "@/lib/i18n";

type Meta = { generatedAt: string; scope: string; sections: string[]; unavailable: string[]; truncated: string[] };
type Answer = { text: string; cards: PortalRecommendationCard[]; fallback: boolean; meta: Meta; notice?: string };
type Turn = { role: "user" | "assistant"; content: string };

const SECTION_LABEL: Record<string, string> = {
  shipment: "Expédition",
  transport: "Transport",
  customs: "Douane",
  documents: "Documents",
  invoices: "Factures",
  notifications: "Notifications",
  contact: "Contact",
};

/** Bounded session history — matches the server's own cap. */
const MAX_TURNS = 12;

export function PortalCopilotPanel({ fileId }: { fileId?: string }) {
  const c = t.portal.premium.copilot;
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
      const r = await fetch("/api/portal/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question, fileId, history }),
      });
      const data = (await r.json().catch(() => null)) as (Answer & { error?: string }) | null;
      if (!r.ok || !data?.text) setError(data?.error ?? c.error);
      else {
        setRes(data);
        setTurns((prev) =>
          [...prev, { role: "user" as const, content: question }, { role: "assistant" as const, content: data.text }].slice(-MAX_TURNS),
        );
        setPrompt("");
      }
    } catch {
      setError(c.network);
    } finally {
      setPending(false);
    }
  }

  function newConversation() {
    setTurns([]);
    setRes(null);
    setError(null);
    setPrompt("");
    setExpanded({});
  }

  function exportText(format: "copy" | "text") {
    if (!res) return;
    const lines = [
      res.text,
      "",
      ...(res.cards.length ? [`${c.cardsLabel} :`] : []),
      ...res.cards.map(
        (card) =>
          `- ${card.title} — ${card.finding}` +
          card.evidence.slice(0, 8).map((e) => `\n    · ${e.reference ?? e.label}${e.detail ? ` — ${e.detail}` : ""}`).join(""),
      ),
    ];
    const text = lines.join("\n");
    if (format === "copy") navigator.clipboard?.writeText(text).catch(() => {});
    else {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `assistant-effitrans-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-teal-50/40 p-5 shadow-card">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-navy-900 text-white" aria-hidden>✨</span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-900">
            {c.title}
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700">{c.badge}</span>
          </p>
          <p className="text-xs text-slate-500">{c.intro}</p>
        </div>
        {turns.length > 0 && (
          <button type="button" onClick={newConversation} className="ml-auto shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">
            {c.newConversation}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {c.prompts.map((p) => (
          <button
            key={p}
            type="button"
            disabled={pending}
            onClick={() => ask(p)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:border-teal-400 hover:text-teal-700 disabled:opacity-40"
          >
            {p}
          </button>
        ))}
      </div>

      {turns.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-l-2 border-teal-100 pl-3">
          {turns.slice(-6).map((turn, i) => (
            <li key={i} className={`text-xs ${turn.role === "user" ? "font-medium text-navy-800" : "text-slate-600"}`}>
              <span className="text-slate-400">{turn.role === "user" ? c.you : c.assistant} : </span>
              {turn.content.length > 220 ? turn.content.slice(0, 220) + "…" : turn.content}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => { e.preventDefault(); ask(prompt); }} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="portal-copilot" className="sr-only">{c.title}</label>
        <input
          id="portal-copilot"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={c.placeholder}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none"
        />
        <button type="submit" disabled={pending || !prompt.trim()} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {pending ? "…" : c.send}
        </button>
      </form>

      <div aria-live="polite" className="mt-3">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {res && (
          <div className="space-y-3">
            {res.notice && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">⚠ {res.notice}</div>}

            <div className="rounded-xl border border-slate-200 bg-white/70 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy-900">{res.text}</p>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                <button type="button" onClick={() => exportText("copy")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">{c.copy}</button>
                <button type="button" onClick={() => exportText("text")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">{c.download}</button>
              </div>
            </div>

            {res.cards.length > 0 && (
              <ul className="space-y-2">
                {res.cards.map((card, i) => (
                  <li key={`${card.kind}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3">
                    <h3 className="text-sm font-semibold text-navy-900">{card.title}</h3>
                    <p className="mt-1 text-sm text-slate-700">{card.finding}</p>
                    <p className="mt-1 text-xs text-slate-500">{card.reasoning}</p>
                    <p className="mt-2 text-xs font-medium text-navy-700">
                      {c.suggestedAction} : <span className="font-normal text-slate-600">{card.suggestedAction}</span>
                    </p>
                    {card.evidence.length > 0 && (
                      <button type="button" onClick={() => setExpanded((p) => ({ ...p, [i]: !p[i] }))} className="mt-2 text-[11px] font-medium text-teal-700 hover:underline">
                        {expanded[i] ? c.hideDetails : c.showDetails} ({card.evidence.length})
                      </button>
                    )}
                    {expanded[i] && (
                      <ul className="mt-1 space-y-0.5 border-l-2 border-slate-100 pl-2">
                        {card.evidence.slice(0, 12).map((e, j) => (
                          <li key={j} className="text-xs text-slate-600">
                            {e.section && <span className="mr-1 rounded bg-slate-100 px-1 text-[9px] uppercase text-slate-500">{SECTION_LABEL[e.section] ?? e.section}</span>}
                            {e.link ? (
                              <a href={e.link} className="font-medium text-teal-700 hover:underline">{e.reference ?? e.label}</a>
                            ) : (
                              <span className="font-medium text-navy-800">{e.reference ?? e.label}</span>
                            )}
                            {e.detail && <span className="ml-1 text-slate-400">· {e.detail}</span>}
                            {e.timestamp && <span className="ml-1 text-slate-400">· {e.timestamp.slice(0, 10)}</span>}
                          </li>
                        ))}
                        {card.evidence.length > 12 && <li className="text-[11px] text-slate-400">… +{card.evidence.length - 12}</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <p className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
              {c.snapshot} {res.meta.generatedAt.slice(0, 16).replace("T", " ")}
              {res.meta.unavailable.length > 0 && ` · ${c.notIncluded} : ${res.meta.unavailable.map((s) => SECTION_LABEL[s] ?? s).join(", ")}`}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

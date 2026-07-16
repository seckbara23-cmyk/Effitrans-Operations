"use client";

/**
 * Logistics Copilot panel (Phase 7.6A + 7.6B). CLIENT.
 * ---------------------------------------------------------------------------
 * Read-only operational assistant. It NEVER calls an AI provider directly — it POSTs to
 * /api/logistics/copilot, which authorizes, builds the bounded read-only context, computes
 * DETERMINISTIC cards, and asks the shared engine (with a deterministic fallback). 7.6B adds:
 * SESSION-ONLY conversation history (React state; lost on refresh; no DB/localStorage), auth-aware
 * suggested prompts, an expandable per-card evidence panel (safe fields only), record drill-downs,
 * controlled export (copy / plain-text download; audited by type+count only), and an admin usage
 * strip. It cannot mutate anything and ships no secret.
 */
import { useEffect, useMemo, useState } from "react";
import type { RecommendationCard, LogisticsModule } from "@/lib/logistics/copilot/types";

type Available = { transport: boolean; customs: boolean; finance: boolean; document: boolean };
type Meta = { generatedAt: string; questionClass: string; modules: LogisticsModule[]; unavailable: LogisticsModule[]; truncated: LogisticsModule[]; counts: { cap: number } };
type Answer = { text: string; cards: RecommendationCard[]; fallback: boolean; meta: Meta; notice?: string };
type Turn = { role: "user" | "assistant"; content: string };
type Usage = { windowDays: number; total: number; answered: number; fallback: number; avgDurationMs: number | null; tokens: { total: number } | null };

const SUGGESTIONS: { q: string; needs?: keyof Available }[] = [
  { q: "Quels dossiers nécessitent une action aujourd'hui ?" },
  { q: "Quelles déclarations douanières sont bloquées ?", needs: "customs" },
  { q: "Quels navires ou vols sont en retard ?", needs: "transport" },
  { q: "Quels documents obligatoires sont manquants ?", needs: "document" },
  { q: "Quels dossiers présentent le plus de risques ?" },
  { q: "Quelles factures sont en retard de paiement ?", needs: "finance" },
  { q: "Quels clients devraient être informés aujourd'hui ?" },
  { q: "Quelles arrivées sont prévues dans les sept prochains jours ?", needs: "transport" },
];
const CONF_TONE: Record<string, string> = { HIGH: "bg-teal-50 text-teal-700", MEDIUM: "bg-amber-50 text-amber-700", LOW: "bg-slate-100 text-slate-500" };
const MODULE_LABEL: Record<string, string> = { road: "Route", ocean: "Maritime", air: "Aérien", customs: "Douane", documents: "Documents", finance: "Finance" };
const MAX_TURNS = 12;

export function LogisticsCopilotPanel({ available = { transport: true, customs: true, finance: true, document: true } }: { available?: Available }) {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [res, setRes] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogisticsModule | "all">("all");
  const [turns, setTurns] = useState<Turn[]>([]); // SESSION-ONLY (no persistence)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    // Admin-only usage strip; silently hidden (403) for non-admins.
    fetch("/api/logistics/copilot/usage").then((r) => (r.ok ? r.json() : null)).then((u) => u && setUsage(u)).catch(() => {});
  }, []);

  const prompts = useMemo(() => SUGGESTIONS.filter((s) => !s.needs || available[s.needs]), [available]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || pending) return;
    setPending(true); setError(null); setFilter("all"); setExpanded({});
    const history = turns.slice(-MAX_TURNS);
    try {
      const r = await fetch("/api/logistics/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: question, history }) });
      const data = (await r.json().catch(() => null)) as (Answer & { error?: string }) | null;
      if (!r.ok || !data?.text) setError(data?.error ?? "Le copilote n'a pas pu répondre.");
      else { setRes(data); setTurns((t) => [...t, { role: "user" as const, content: question }, { role: "assistant" as const, content: data.text }].slice(-MAX_TURNS)); }
    } catch {
      setError("Réseau indisponible. Réessayez.");
    } finally { setPending(false); }
  }

  function newConversation() { setTurns([]); setRes(null); setError(null); setPrompt(""); setExpanded({}); }

  function exportText(format: "copy" | "text") {
    if (!res) return;
    const lines = [res.text, "", "Recommandations :", ...res.cards.map((c) => `- ${c.title} (${c.confidence}) — ${c.finding}` + c.evidence.slice(0, 8).map((e) => `\n    · ${e.reference ?? e.label}${e.detail ? ` — ${e.detail}` : ""}`).join(""))];
    const text = lines.join("\n");
    if (format === "copy") navigator.clipboard?.writeText(text).catch(() => {});
    else {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `copilote-logistique-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click(); URL.revokeObjectURL(a.href);
    }
    fetch("/api/logistics/copilot/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format, count: res.cards.length }) }).catch(() => {});
  }

  const moduleTabs = useMemo(() => (res ? Array.from(new Set(res.cards.flatMap((c) => c.sourceModules))) : []), [res]);
  const visibleCards = useMemo(() => (res ? res.cards.filter((c) => filter === "all" || c.sourceModules.includes(filter)) : []), [res, filter]);

  return (
    <section className="surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden>🧭</span>
        <h2 className="text-sm font-semibold text-navy-900">Copilote logistique</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Lecture seule · recommandations</span>
        {turns.length > 0 && <button type="button" onClick={newConversation} className="ml-auto rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">Nouvelle conversation</button>}
      </div>

      {usage && (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
          Usage ({usage.windowDays} j) : {usage.total} requête(s) · {usage.answered} répondues · {usage.fallback} repli(s){usage.avgDurationMs != null ? ` · ${usage.avgDurationMs} ms moy.` : ""}{usage.tokens ? ` · ${usage.tokens.total} jetons` : ""}.
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {prompts.map((s) => (
          <button key={s.q} type="button" disabled={pending} onClick={() => { setPrompt(s.q); ask(s.q); }} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-teal-300 disabled:opacity-40">{s.q}</button>
        ))}
      </div>

      {turns.length > 0 && (
        <ul className="mb-3 space-y-1.5 border-l-2 border-slate-100 pl-3">
          {turns.slice(-6).map((t, i) => (
            <li key={i} className={`text-xs ${t.role === "user" ? "font-medium text-navy-800" : "text-slate-600"}`}><span className="text-slate-400">{t.role === "user" ? "Vous" : "Copilote"} : </span>{t.content.length > 220 ? t.content.slice(0, 220) + "…" : t.content}</li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => { e.preventDefault(); ask(prompt); }} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="lg-copilot" className="sr-only">Question logistique</label>
        <input id="lg-copilot" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Posez une question opérationnelle…" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
        <button type="submit" disabled={pending || !prompt.trim()} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{pending ? "…" : "Demander"}</button>
      </form>

      <div aria-live="polite" className="mt-3">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {res && (
          <div className="space-y-3">
            {res.notice && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">⚠ {res.notice} — synthèse déterministe affichée (aucune donnée inventée).</div>}

            <div className="rounded-xl border border-slate-200 bg-sand-50/60 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy-900">{res.text}</p>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                <button type="button" onClick={() => exportText("copy")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">Copier</button>
                <button type="button" onClick={() => exportText("text")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">Télécharger (.txt)</button>
              </div>
            </div>

            {res.cards.length > 0 && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setFilter("all")} className={`rounded-full px-2.5 py-1 text-[11px] ${filter === "all" ? "bg-navy-900 text-white" : "border border-slate-200 text-slate-600"}`}>Tous ({res.cards.length})</button>
                  {moduleTabs.map((m) => (
                    <button key={m} type="button" onClick={() => setFilter(m)} className={`rounded-full px-2.5 py-1 text-[11px] ${filter === m ? "bg-navy-900 text-white" : "border border-slate-200 text-slate-600"}`}>{MODULE_LABEL[m] ?? m}</button>
                  ))}
                </div>

                <ul className="space-y-2">
                  {visibleCards.map((c, i) => (
                    <li key={`${c.kind}-${i}`} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-navy-900">{c.title}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CONF_TONE[c.confidence] ?? "bg-slate-100 text-slate-500"}`}>Confiance {c.confidence}</span>
                        <span className="text-[10px] text-slate-400">{c.sourceModules.map((m) => MODULE_LABEL[m] ?? m).join(" · ")}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{c.finding}</p>
                      <p className="mt-1 text-xs text-slate-500">{c.reasoning}</p>
                      <p className="mt-2 text-xs font-medium text-navy-700">Action suggérée : <span className="font-normal text-slate-600">{c.suggestedAction}</span></p>
                      {c.evidence.length > 0 && (
                        <button type="button" onClick={() => setExpanded((p) => ({ ...p, [i]: !p[i] }))} className="mt-2 text-[11px] font-medium text-teal-700 hover:underline">{expanded[i] ? "Masquer" : "Voir"} les preuves ({c.evidence.length})</button>
                      )}
                      {expanded[i] && (
                        <ul className="mt-1 space-y-0.5 border-l-2 border-slate-100 pl-2">
                          {c.evidence.slice(0, 12).map((e, j) => (
                            <li key={j} className="text-xs text-slate-600">
                              {e.module && <span className="mr-1 rounded bg-slate-100 px-1 text-[9px] uppercase text-slate-500">{MODULE_LABEL[e.module] ?? e.module}</span>}
                              {e.link ? <a href={e.link} className="tabular font-medium text-teal-700 hover:underline">{e.reference ?? e.label}</a> : <span className="tabular font-medium text-navy-800">{e.reference ?? e.label}</span>}
                              {e.status && <span className="ml-1 text-slate-400">· {e.status}</span>}
                              {e.detail && <span className="ml-1 text-slate-400">· {e.detail}</span>}
                              {e.timestamp && <span className="ml-1 text-slate-400">· {e.timestamp.slice(0, 10)}</span>}
                            </li>
                          ))}
                          {c.evidence.length > 12 && <li className="text-[11px] text-slate-400">… +{c.evidence.length - 12} de plus</li>}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
              Lecture seule · instantané du {res.meta.generatedAt.slice(0, 16).replace("T", " ")} · modules : {res.meta.modules.length ? res.meta.modules.map((m) => MODULE_LABEL[m] ?? m).join(", ") : "aucun"}
              {res.meta.unavailable.length > 0 && ` · non inclus : ${res.meta.unavailable.map((m) => MODULE_LABEL[m] ?? m).join(", ")}`}
              {res.meta.truncated.length > 0 && ` · tronqué : ${res.meta.truncated.map((m) => MODULE_LABEL[m] ?? m).join(", ")}`}.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

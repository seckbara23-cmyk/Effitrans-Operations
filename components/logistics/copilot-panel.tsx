"use client";

/**
 * Logistics Copilot panel (Phase 7.6A). CLIENT.
 * ---------------------------------------------------------------------------
 * Read-only operational assistant. It NEVER calls an AI provider directly — it POSTs to
 * /api/logistics/copilot, which authorizes, builds the bounded read-only context, computes
 * DETERMINISTIC recommendation cards, and asks the shared engine for a grounded answer (with a
 * deterministic fallback when the provider is down). The panel shows the answer, the cards
 * (finding / evidence / confidence / suggested action / source modules), module filters, and a
 * freshness + "modules not included" footer. It cannot mutate anything.
 */
import { useMemo, useState } from "react";
import type { RecommendationCard, LogisticsModule } from "@/lib/logistics/copilot/types";

const SUGGESTIONS = [
  "Quelles expéditions nécessitent une attention ?",
  "Quelles déclarations douanières sont bloquées ?",
  "Quels conteneurs arrivent cette semaine ?",
  "Quels vols sont en retard ?",
  "Quels clients faut-il notifier ?",
  "Quels documents manquent ?",
  "Quelles factures sont en souffrance ?",
  "Quelles expéditions présentent un risque élevé ?",
];

const CONF_TONE: Record<string, string> = { HIGH: "bg-teal-50 text-teal-700", MEDIUM: "bg-amber-50 text-amber-700", LOW: "bg-slate-100 text-slate-500" };
const MODULE_LABEL: Record<string, string> = { road: "Route", ocean: "Maritime", air: "Aérien", customs: "Douane", documents: "Documents", finance: "Finance" };

type Meta = { generatedAt: string; modules: LogisticsModule[]; unavailable: LogisticsModule[]; counts: { cap: number } };
type Answer = { text: string; cards: RecommendationCard[]; fallback: boolean; meta: Meta; notice?: string };

export function LogisticsCopilotPanel() {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [res, setRes] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogisticsModule | "all">("all");

  async function ask(q: string) {
    const question = q.trim();
    if (!question || pending) return;
    setPending(true); setError(null); setRes(null); setFilter("all");
    try {
      const r = await fetch("/api/logistics/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: question }) });
      const data = (await r.json().catch(() => null)) as (Answer & { error?: string }) | null;
      if (!r.ok || !data?.text) setError(data?.error ?? "Le copilote n'a pas pu répondre.");
      else setRes(data);
    } catch {
      setError("Réseau indisponible. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  const moduleTabs = useMemo(() => {
    if (!res) return [] as LogisticsModule[];
    return Array.from(new Set(res.cards.flatMap((c) => c.sourceModules)));
  }, [res]);
  const visibleCards = useMemo(() => (res ? res.cards.filter((c) => filter === "all" || c.sourceModules.includes(filter)) : []), [res, filter]);

  return (
    <section className="surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden>🧭</span>
        <h2 className="text-sm font-semibold text-navy-900">Copilote logistique</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Lecture seule · recommandations</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => { setPrompt(s); ask(s); }} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-teal-300 disabled:opacity-40">{s}</button>
        ))}
      </div>

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
                      {c.evidence.length > 0 && (
                        <ul className="mt-2 space-y-0.5 border-l-2 border-slate-100 pl-2">
                          {c.evidence.slice(0, 8).map((e, j) => (
                            <li key={j} className="text-xs text-slate-600">
                              {e.link ? <a href={e.link} className="tabular font-medium text-teal-700 hover:underline">{e.reference ?? e.label}</a> : <span className="tabular font-medium text-navy-800">{e.reference ?? e.label}</span>}
                              {e.detail && <span className="ml-1 text-slate-400">· {e.detail}</span>}
                            </li>
                          ))}
                          {c.evidence.length > 8 && <li className="text-[11px] text-slate-400">… +{c.evidence.length - 8} de plus</li>}
                        </ul>
                      )}
                      <p className="mt-2 text-xs font-medium text-navy-700">Action suggérée : <span className="font-normal text-slate-600">{c.suggestedAction}</span></p>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
              Lecture seule · instantané du {res.meta.generatedAt.slice(0, 16).replace("T", " ")} · modules consultés : {res.meta.modules.length ? res.meta.modules.map((m) => MODULE_LABEL[m] ?? m).join(", ") : "aucun"}
              {res.meta.unavailable.length > 0 && ` · non inclus (donnée manquante ≠ absence de problème) : ${res.meta.unavailable.map((m) => MODULE_LABEL[m] ?? m).join(", ")}`}.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

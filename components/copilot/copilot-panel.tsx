"use client";

/**
 * Operations Copilot panel (Phase 3.1A + 3.4F-3 polish). Client component.
 * ---------------------------------------------------------------------------
 * A right-side drawer on the dossier page. Read-only: it POSTs the current fileId
 * + question (+ recent history) to /api/copilot and renders the plain-text reply.
 * It holds no domain data and performs no mutation — all authorization + context
 * building happen server-side. Polish: skill chips, a helpful empty state,
 * animated loading steps, provider badge, progressive answer reveal, a 30-second
 * repeat-question cache, a collapsible transparency footer, copy, and export
 * (PDF / Word / Email — all dependency-free, client-side).
 */
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { COPILOT_SKILLS, type CopilotSkill } from "@/lib/copilot/skills";
import { providerDisplay, type ProviderTier } from "@/lib/copilot/provider-ux";
import { answerToPdfBytes, answerToRtf, answerToEml, exportFilename } from "@/lib/copilot/export";

type Meta = {
  skill: string;
  sources: string[];
  restricted: string[];
  unknown: string[];
  confidence: "high" | "medium" | "low";
};
type Turn = { role: "user" | "assistant"; text: string; meta?: Meta };
type ProviderInfo = { label: string; tier: ProviderTier };

const ERROR_BY_STATUS: Record<number, string> = {
  403: t.copilot.errors.forbidden,
  404: t.copilot.errors.notFound,
  429: t.copilot.errors.rateLimited,
  502: t.copilot.errors.upstream,
  503: t.copilot.errors.unconfigured,
  504: t.copilot.errors.timeout,
};

const CACHE_TTL_MS = 30_000; // D7 — repeat-question cache window
const REVEAL_STEP = 4; // chars per tick
const REVEAL_TICK_MS = 16;
const HISTORY_TURNS = 6;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function triggerDownload(filename: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CopilotPanel({ fileId }: { fileId: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [revealLen, setRevealLen] = useState(0);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, { text: string; meta?: Meta; at: number }>>(new Map());

  const errText = () => t.copilot.errors.generic;

  // Provider badge (D3) — GET is auth + file:read gated; secret-free.
  useEffect(() => {
    if (!open || provider) return;
    let cancelled = false;
    fetch("/api/copilot")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { provider?: string; model?: string } | null) => {
        if (!cancelled && d?.provider) setProvider(providerDisplay(d.provider, d.model ?? null));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, provider]);

  // Rotating loading steps (D2).
  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      return;
    }
    const id = window.setInterval(() => setLoadingStep((s) => (s + 1) % t.copilot.loading.steps.length), 1400);
    return () => window.clearInterval(id);
  }, [loading]);

  // Progressive reveal of the newest assistant answer (D5).
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (!last || last.role !== "assistant") return;
    const full = last.text.length;
    setRevealLen(0);
    let cur = 0;
    const id = window.setInterval(() => {
      cur = Math.min(full, cur + REVEAL_STEP);
      setRevealLen(cur);
      if (cur >= full) window.clearInterval(id);
    }, REVEAL_TICK_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
  }, [turns, revealLen, loading]);

  const lastAssistantIdx = turns.length > 0 && turns[turns.length - 1].role === "assistant" ? turns.length - 1 : -1;

  async function ask(question: string, skill?: CopilotSkill) {
    const q = question.trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    const prior = turns; // history BEFORE this question

    // D7 — return a cached answer for the same question within the TTL.
    const cached = cacheRef.current.get(norm(q));
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setTurns([...prior, { role: "user", text: q }, { role: "assistant", text: cached.text, meta: cached.meta }]);
      return;
    }

    setTurns([...prior, { role: "user", text: q }]);
    setLoading(true);
    try {
      const history = prior.slice(-HISTORY_TURNS).map((tr) => ({ role: tr.role, text: tr.text }));
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, prompt: q, ...(skill ? { skill } : {}), history }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(detail?.error || ERROR_BY_STATUS[res.status] || errText());
        return;
      }
      const data = (await res.json()) as { text?: string; meta?: Meta };
      const text = data.text ?? "";
      cacheRef.current.set(norm(q), { text, meta: data.meta, at: Date.now() });
      setTurns((prev) => [...prev, { role: "assistant", text, meta: data.meta }]);
    } catch {
      setError(errText());
    } finally {
      setLoading(false);
    }
  }

  async function copy(idx: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  const stem = exportFilename(fileId);
  const exportPdf = (text: string) => triggerDownload(`${stem}.pdf`, answerToPdfBytes(text), "application/pdf");
  const exportWord = (text: string) => triggerDownload(`${stem}.rtf`, answerToRtf(text), "application/rtf");
  const exportEmail = (text: string) => triggerDownload(`${stem}.eml`, answerToEml(text), "message/rfc822");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-navy-900 px-5 py-3 text-sm font-medium text-white shadow-lg hover:bg-navy-800"
        aria-label={t.copilot.launch}
      >
        <span aria-hidden>✨</span>
        {t.copilot.launch}
      </button>
    );
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl" role="dialog" aria-label={t.copilot.title}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{t.copilot.title}</h2>
          <p className="text-xs text-slate-500">{t.copilot.subtitle}</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-navy-900">
          {t.copilot.close}
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {turns.length === 0 && !loading && <EmptyState />}

        {turns.map((turn, i) => {
          const shown = i === lastAssistantIdx ? turn.text.slice(0, revealLen) : turn.text;
          return (
            <div key={i} className={turn.role === "user" ? "text-right" : "text-left"}>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {turn.role === "user" ? t.copilot.youLabel : t.copilot.assistantLabel}
              </p>
              <div
                className={`inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  turn.role === "user" ? "bg-navy-900 text-left text-white" : "bg-slate-100 text-navy-900"
                }`}
              >
                {shown}
              </div>
              {turn.role === "assistant" && (
                <>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <ActionButton onClick={() => copy(i, turn.text)}>{copiedIdx === i ? `✓ ${t.copilot.copied}` : `📋 ${t.copilot.copy}`}</ActionButton>
                    <ActionButton onClick={() => exportPdf(turn.text)}>{t.copilot.export.pdf}</ActionButton>
                    <ActionButton onClick={() => exportWord(turn.text)}>{t.copilot.export.word}</ActionButton>
                    <ActionButton onClick={() => exportEmail(turn.text)}>{t.copilot.export.email}</ActionButton>
                  </div>
                  {turn.meta && <TransparencyFooter meta={turn.meta} />}
                </>
              )}
            </div>
          );
        })}

        {loading && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-navy-800">🤖 {t.copilot.loading.title}</p>
            <p className="flex items-center gap-2 text-xs text-slate-500">
              {t.copilot.loading.steps[loadingStep]}
              <LoadingDots />
            </p>
          </div>
        )}
        {error && <p className="text-sm text-red-600 whitespace-pre-wrap">{error}</p>}
      </div>

      <div className="border-t border-slate-200 px-5 py-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">{t.copilot.skillsLabel}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {COPILOT_SKILLS.map((id) => {
            const s = t.copilot.skills[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => ask(s.q, id)}
                disabled={loading}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:text-teal-700 disabled:opacity-50"
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={2}
            placeholder={t.copilot.placeholder}
            className="min-h-0 flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          />
          <button type="submit" disabled={loading || input.trim() === ""} className="rounded-md bg-navy-900 px-3 py-2 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            {t.copilot.send}
          </button>
        </form>

        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
          <span>{t.copilot.disclaimer}</span>
          <ProviderBadge provider={provider} />
        </div>
      </div>
    </aside>
  );
}

function EmptyState() {
  const e = t.copilot.empty;
  return (
    <div className="space-y-3">
      <p className="text-base font-semibold text-navy-900">{e.greeting}</p>
      <p className="text-sm text-slate-600">{e.intro}</p>
      <ul className="space-y-1.5">
        {e.bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm text-slate-600">
            <span className="mt-0.5 text-teal-600" aria-hidden>•</span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-500" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: ProviderInfo | null }) {
  if (!provider) return <span className="text-slate-300">{t.copilot.provider.loading}</span>;
  const tier = t.copilot.provider.tiers[provider.tier];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
      <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden />
      {provider.label} • {tier}
    </span>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:border-teal-500 hover:text-teal-700"
    >
      {children}
    </button>
  );
}

/**
 * Collapsible transparency footer (D4/D10/D11). Values come from the server
 * (computed from the context, never self-reported by the model). Collapsed by
 * default; cites sources by SECTION NAME, flags permission restrictions and
 * genuinely-unknown facts, and shows a confidence level.
 */
function TransparencyFooter({ meta }: { meta: Meta }) {
  const tr = t.copilot.transparency;
  const confClass = meta.confidence === "high" ? "text-teal-700" : meta.confidence === "medium" ? "text-amber-700" : "text-red-700";
  return (
    <details className="mt-1.5 text-[10px] text-slate-400">
      <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-600">{tr.detailsLabel}</summary>
      <div className="mt-1 space-y-0.5 border-l-2 border-slate-200 pl-2 leading-relaxed">
        {meta.sources.length > 0 && (
          <div>
            <span className="font-medium text-slate-500">{tr.sources} :</span> {meta.sources.join(" · ")}
          </div>
        )}
        {meta.restricted.length > 0 && (
          <div>
            <span className="font-medium text-slate-500">{tr.restricted} :</span> {meta.restricted.join(" · ")}
          </div>
        )}
        {meta.unknown.length > 0 && (
          <div>
            <span className="font-medium text-slate-500">{tr.unknown} :</span> {meta.unknown.join(" · ")}
          </div>
        )}
        <div>
          <span className="font-medium text-slate-500">{tr.confidence} :</span> <span className={confClass}>{tr.levels[meta.confidence]}</span>
        </div>
      </div>
    </details>
  );
}

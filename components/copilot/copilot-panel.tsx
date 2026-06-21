"use client";

/**
 * Operations Copilot panel (Phase 3.1A). Client component.
 * ---------------------------------------------------------------------------
 * A right-side drawer on the dossier page. Read-only: it only POSTs the current
 * fileId + a question to /api/copilot and renders the plain-text reply. It holds
 * no domain data and performs no mutation — all authorization and context
 * building happen server-side in the route.
 */
import { useRef, useState } from "react";
import { t } from "@/lib/i18n";

type Turn = { role: "user" | "assistant"; text: string };

const ERROR_BY_STATUS: Record<number, string> = {
  403: t.copilot.errors.forbidden,
  404: t.copilot.errors.notFound,
  502: t.copilot.errors.upstream,
  503: t.copilot.errors.unconfigured,
};

export function CopilotPanel({ fileId }: { fileId: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    setTurns((prev) => [...prev, { role: "user", text: q }]);
    setLoading(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, prompt: q }),
      });
      if (!res.ok) {
        setError(ERROR_BY_STATUS[res.status] ?? t.copilot.errors.generic);
        return;
      }
      const data = (await res.json()) as { text?: string };
      setTurns((prev) => [...prev, { role: "assistant", text: data.text ?? "" }]);
      // Scroll to the latest reply on the next paint.
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      });
    } catch {
      setError(t.copilot.errors.generic);
    } finally {
      setLoading(false);
    }
  }

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
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
      role="dialog"
      aria-label={t.copilot.title}
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{t.copilot.title}</h2>
          <p className="text-xs text-slate-500">{t.copilot.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-navy-900"
        >
          {t.copilot.close}
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {turns.length === 0 && <p className="text-sm text-slate-500">{t.copilot.intro}</p>}

        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "text-right" : "text-left"}>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {turn.role === "user" ? t.copilot.youLabel : t.copilot.assistantLabel}
            </p>
            <div
              className={`inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                turn.role === "user"
                  ? "bg-navy-900 text-left text-white"
                  : "bg-slate-100 text-navy-900"
              }`}
            >
              {turn.text}
            </div>
          </div>
        ))}

        {loading && <p className="text-sm text-slate-400">{t.copilot.thinking}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="border-t border-slate-200 px-5 py-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {t.copilot.suggestionsLabel}
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {t.copilot.prompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => ask(p)}
              disabled={loading}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:text-teal-700 disabled:opacity-50"
            >
              {p}
            </button>
          ))}
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
          <button
            type="submit"
            disabled={loading || input.trim() === ""}
            className="rounded-md bg-navy-900 px-3 py-2 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {t.copilot.send}
          </button>
        </form>
        <p className="mt-2 text-[11px] text-slate-400">{t.copilot.disclaimer}</p>
      </div>
    </aside>
  );
}

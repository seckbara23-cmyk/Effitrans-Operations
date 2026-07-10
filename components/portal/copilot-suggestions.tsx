"use client";

/**
 * Client Copilot preparation panel (Phase 3.3 D12). UI ONLY — no backend, no GPT.
 * The suggestion chips preview the questions the future assistant will answer.
 */
import { useState } from "react";
import { t } from "@/lib/i18n";

export function CopilotSuggestions() {
  const [msg, setMsg] = useState<string | null>(null);
  const c = t.portal.premium.copilot;

  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-teal-50/40 p-5 shadow-card">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-navy-900 text-white" aria-hidden>✨</span>
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-navy-900">
            {c.title}
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700">{c.badge}</span>
          </p>
          <p className="text-xs text-slate-500">{c.intro}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {c.prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setMsg(c.soon)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:border-teal-400 hover:text-teal-700"
          >
            {p}
          </button>
        ))}
      </div>

      {msg && (
        <p className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-800" role="status">{msg}</p>
      )}
    </div>
  );
}

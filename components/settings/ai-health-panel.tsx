"use client";

/**
 * Admin AI health panel (Phase 3.4F-3). Client component.
 * ---------------------------------------------------------------------------
 * Renders the SECRET-FREE AI status (provider, model, flags, reachability, model
 * present, Ollama version, health latency) and a "Tester la connexion IA" button
 * that re-fetches GET /api/ai/health for the current request. It imports NOTHING
 * from lib/ai (no server-only code, no config) — it only reads the endpoint's
 * JSON — so no provider config or URL leaks into the client bundle. It never
 * shows keys, full URLs, prompts, responses, or dossier data.
 */
import { useState } from "react";
import { t } from "@/lib/i18n";

/** The secret-free subset of /api/ai/health this panel displays. */
export type AiHealthView = {
  provider: string | null;
  model: string | null;
  copilotEnabled: boolean;
  localProviderEnabled: boolean;
  hosted: boolean;
  baseUrlHost: string | null;
  configOk: boolean;
  configError?: string | null;
  health?: {
    healthy?: boolean;
    reachable?: boolean;
    modelPresent?: boolean;
    version?: string;
    latencyMs?: number;
  } | null;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm text-navy-900">{children}</span>
    </div>
  );
}

function YesNo({ v }: { v: boolean | null | undefined }) {
  const s = t.aiSettings;
  if (v === null || v === undefined) return <span className="text-slate-400">—</span>;
  return <span className={v ? "text-teal-700" : "text-red-600"}>{v ? s.yes : s.no}</span>;
}

export function AiHealthPanel({ initial }: { initial: AiHealthView }) {
  const s = t.aiSettings;
  const [view, setView] = useState<AiHealthView>(initial);
  const [pending, setPending] = useState(false);
  const [lastTest, setLastTest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function test() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/health", { method: "GET" });
      if (!res.ok) {
        setError(`${s.testFailed} (HTTP ${res.status})`);
      } else {
        const data = (await res.json()) as AiHealthView;
        setView(data);
        setLastTest(new Date().toLocaleTimeString("fr-FR"));
      }
    } catch {
      setError(s.testFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="surface space-y-1 p-5">
        <Row label={s.fields.provider}>{view.provider ?? "—"}</Row>
        <Row label={s.fields.model}>{view.model ?? "—"}</Row>
        <Row label={s.fields.enabled}><YesNo v={view.copilotEnabled} /></Row>
        <Row label={s.fields.localEnabled}><YesNo v={view.localProviderEnabled} /></Row>
        <Row label={s.fields.host}>{view.baseUrlHost ?? "—"}</Row>
        <Row label={s.fields.reachable}><YesNo v={view.health?.reachable} /></Row>
        <Row label={s.fields.modelInstalled}><YesNo v={view.health?.modelPresent} /></Row>
        <Row label={s.fields.version}>{view.health?.version ?? "—"}</Row>
        <Row label={s.fields.latency}>{view.health?.latencyMs != null ? `${view.health.latencyMs} ms` : "—"}</Row>
        <Row label={s.fields.status}>
          {view.configOk ? <span className="text-teal-700">{s.ok}</span> : <span className="text-red-600">{view.configError ?? s.configError}</span>}
        </Row>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={test}
          disabled={pending}
          className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {pending ? s.testing : s.test}
        </button>
        <span className="text-xs text-slate-400">
          {s.lastTest} : {lastTest ?? s.never}
        </span>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{s.prodNote}</p>
    </div>
  );
}

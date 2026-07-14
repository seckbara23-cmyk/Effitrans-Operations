"use client";

/**
 * Per-tenant rollout controls (Phase 5.0E-2A).
 * ---------------------------------------------------------------------------
 * Four toggles and one rollback button. The rollback is deliberately separate and
 * deliberately red: under pressure nobody should have to remember which four
 * checkboxes to untick, and the audit trail should say ROLLBACK rather than leave
 * someone to infer it from a diff.
 *
 * A sub-capability is disabled in the UI while the engine is off, because a queue
 * over a dark engine renders as a permanently empty list — the server enforces the
 * same rule, twice (normalizeRollout and a CHECK constraint).
 */
import { useState, useTransition } from "react";
import { setTenantRollout, rollbackTenantRollout } from "@/lib/platform/rollout-actions";
import type { TenantRolloutRow } from "@/lib/platform/rollout-read";
import type { RolloutFeature } from "@/lib/process/rollout";

const FEATURES: { key: RolloutFeature; label: string; hint: string }[] = [
  { key: "process_engine", label: "Moteur de processus", hint: "Les 25+1 étapes officielles. Requis par tout le reste." },
  { key: "process_workspaces", label: "Espaces de travail", hint: "Mon travail, les 15 files, la tour de contrôle." },
  { key: "physical_invoice_deposit", label: "Dépôt physique", hint: "Remise papier des factures + chaîne de garde." },
  { key: "collections", label: "Recouvrement", hint: "Balance âgée, relances, clôture explicite." },
];

export function RolloutControls({
  row,
  killSwitchOn,
}: {
  row: TenantRolloutRow;
  killSwitchOn: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState(row.rollout);

  function toggle(key: RolloutFeature, value: boolean) {
    setError(null);
    // Optimistic, but honest: turning the engine off takes everything with it here
    // exactly as it does on the server.
    const next = { ...state, [key]: value };
    if (key === "process_engine" && !value) {
      next.process_workspaces = false;
      next.physical_invoice_deposit = false;
      next.collections = false;
    }
    setState(next);

    startTransition(async () => {
      const res = await setTenantRollout({ tenantId: row.tenantId, ...next });
      if (!res.ok) {
        setError(res.error);
        setState(row.rollout);
      } else {
        setState(res.rollout);
      }
    });
  }

  function rollback() {
    const reason = window.prompt("Motif du rollback (inscrit au journal d'audit) :");
    if (!reason) return;
    setError(null);
    startTransition(async () => {
      const res = await rollbackTenantRollout(row.tenantId, reason);
      if (!res.ok) setError(res.error);
      else setState(res.rollout);
    });
  }

  const live = killSwitchOn && state.process_engine;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-base font-bold text-white">{row.companyName}</p>
          <p className="text-xs text-slate-500">
            {live ? "Processus officiel ACTIF" : "Processus officiel inactif"}
            {row.firstEnabledAt && ` · première activation ${row.firstEnabledAt.slice(0, 10)}`}
            {!killSwitchOn && state.process_engine && (
              <span className="ml-1 text-amber-400">
                (coché, mais l&apos;interrupteur global est coupé)
              </span>
            )}
          </p>
        </div>
        {state.process_engine && (
          <button
            onClick={rollback}
            disabled={pending}
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          >
            Rollback immédiat
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {FEATURES.map((f) => {
          const isEngine = f.key === "process_engine";
          const locked = !isEngine && !state.process_engine;
          return (
            <label
              key={f.key}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.03] p-3 ${
                locked ? "cursor-not-allowed opacity-40" : "hover:bg-white/[0.06]"
              }`}
            >
              <input
                type="checkbox"
                checked={state[f.key]}
                disabled={pending || locked}
                onChange={(e) => toggle(f.key, e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/10"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">{f.label}</span>
                <span className="block text-xs text-slate-500">{f.hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      {error && (
        <p className="mt-3 text-xs font-medium text-red-400">
          Échec : {error === "forbidden" ? "permission plateforme requise" : error}
        </p>
      )}
    </div>
  );
}

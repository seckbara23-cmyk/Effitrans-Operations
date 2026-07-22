"use client";

/**
 * Per-tenant Messaging Center rollout toggle (Phase 8.7). Single checkbox — a much
 * smaller control than RolloutControls since there is exactly one capability, not four.
 */
import { useState, useTransition } from "react";
import { setTenantMessagingRollout } from "@/lib/platform/messaging-rollout-actions";
import type { MessagingRolloutRow } from "@/lib/platform/messaging-rollout-read";

export function MessagingRolloutControls({ row, killSwitchOn }: { row: MessagingRolloutRow; killSwitchOn: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(row.enabled);

  function toggle(value: boolean) {
    setError(null);
    setEnabled(value);
    startTransition(async () => {
      const res = await setTenantMessagingRollout(row.tenantId, value);
      if (!res.ok) {
        setError(res.error);
        setEnabled(row.enabled);
      }
    });
  }

  const live = killSwitchOn && enabled;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">
          {row.companyName}
          {row.slug && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] font-normal text-slate-300">{row.slug}</span>}
        </p>
        <p className="text-xs text-slate-500">
          {live ? "Messagerie ACTIVE" : "Messagerie inactive"}
          {!killSwitchOn && enabled && <span className="ml-1 text-amber-400">(coché, mais l&apos;interrupteur global est coupé)</span>}
        </p>
      </div>
      <label className={`flex cursor-pointer items-center gap-2 ${pending ? "opacity-60" : ""}`}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 rounded border-white/20 bg-white/10"
        />
        <span className="text-xs text-slate-400">Activer</span>
      </label>
      {error && <p className="w-full text-xs font-medium text-red-400">Échec : {error === "forbidden" ? "permission plateforme requise" : error}</p>}
    </div>
  );
}

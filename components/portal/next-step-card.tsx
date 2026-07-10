import { t } from "@/lib/i18n";
import type { PortalNextStep, NextStepParty } from "@/lib/portal/tracking-derive";

const PARTY_ICON: Record<NextStepParty, string> = {
  effitrans: "🏢",
  client: "👤",
  customs: "🛃",
  carrier: "🚚",
};

/** Explicit next-step block under the summary (Phase 3.3A D7). */
export function NextStepCard({ nextStep }: { nextStep: PortalNextStep }) {
  const ns = t.portal.premium.nextStep;
  return (
    <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-white to-teal-50/50 p-5 shadow-card">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-navy-900 text-white" aria-hidden>→</span>
        <p className="text-[11px] uppercase tracking-wide text-slate-500">{ns.title}</p>
      </div>
      <p className="mt-2 text-lg font-bold text-navy-900">{nextStep.title}</p>
      <p className="mt-1 text-sm text-slate-600">{nextStep.explanation}</p>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span aria-hidden>{PARTY_ICON[nextStep.party]}</span>
        <span className="text-slate-400">{ns.responsible}:</span>
        <span className="font-medium text-navy-800">{ns.parties[nextStep.party]}</span>
      </div>

      {nextStep.clientAction ? (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">{ns.actionRequired}</p>
          <p className="mt-0.5 text-sm text-amber-900">{nextStep.clientAction}</p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">{ns.noAction}</p>
      )}
    </div>
  );
}

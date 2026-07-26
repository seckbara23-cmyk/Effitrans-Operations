/**
 * Autorisation de Dépenses — approval timeline (Phase 11.0D). SERVER component.
 * ---------------------------------------------------------------------------
 * Renders the chain projection produced by the pure evaluator (lib/finance/
 * expense/visa.ts). It computes NOTHING: the state of each step, the current
 * stage and the blocked stage all arrive decided, so this screen can never
 * disagree with what the sign action will actually allow.
 *
 * The seven steps are the ones PRINTED on the paper form, in the printed order.
 */
import type { ChainStepView } from "@/lib/finance/expense/visa";
import type { ExpenseVisaView } from "@/lib/finance/expense/readers";

const STATE_STYLE: Record<ChainStepView["state"], { dot: string; label: string; tone: string }> = {
  SIGNED: { dot: "bg-teal-600", label: "Visé", tone: "text-teal-700" },
  CURRENT: { dot: "bg-amber-500 ring-4 ring-amber-100", label: "En attente de visa", tone: "text-amber-700" },
  BLOCKED: { dot: "bg-slate-300 ring-4 ring-slate-100", label: "Signataire non configuré", tone: "text-slate-500" },
  REFUSED: { dot: "bg-red-600", label: "Refusé", tone: "text-red-700" },
  PENDING: { dot: "bg-slate-200", label: "À venir", tone: "text-slate-400" },
};

const frDateTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

export function ApprovalTimeline({
  steps,
  attemptNumber,
  history,
}: {
  steps: ChainStepView[];
  attemptNumber: number | null;
  history: ExpenseVisaView[];
}) {
  // History from EARLIER rounds — the current round is already shown on the steps.
  const priorRounds = history.length > steps.filter((s) => s.state === "SIGNED" || s.state === "REFUSED").length;

  return (
    <section className="surface space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">Circuit de visas</h2>
        {attemptNumber != null && (
          <span className="text-xs text-slate-400">Tour d'approbation n° {attemptNumber}</span>
        )}
      </div>

      <ol className="space-y-0">
        {steps.map((step, i) => {
          const style = STATE_STYLE[step.state];
          return (
            <li key={step.code} className="relative flex gap-3 pb-4 last:pb-0">
              {/* Connector */}
              {i < steps.length - 1 && (
                <span className="absolute left-[5px] top-4 h-full w-px bg-slate-200" aria-hidden />
              )}
              <span className={`relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-medium text-navy-900">
                    {step.ordinal}. {step.labelFr}
                  </p>
                  <span className={`text-xs ${style.tone}`}>{style.label}</span>
                </div>

                {step.state === "BLOCKED" && (
                  <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                    Le circuit s'arrête ici : la direction n'a pas encore désigné le signataire de cette
                    étape. Aucun visa ne peut être apposé, et aucune étape suivante n'est accessible.
                  </p>
                )}

                {(step.state === "SIGNED" || step.state === "REFUSED") && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {step.signerDisplayName}
                    {step.decidedAt ? ` · ${frDateTime(step.decidedAt)}` : ""}
                  </p>
                )}

                {step.comment && (
                  <p className="mt-1 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">« {step.comment} »</p>
                )}

                {step.state === "PENDING" && step.roleCode && (
                  <p className="mt-0.5 text-[11px] text-slate-400">Signataire attendu : {step.roleCode}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {priorRounds && (
        <details className="border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-navy-900">
            Historique complet des visas ({history.length})
          </summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {history.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-xs">
                <span className="font-medium text-navy-900">{v.stepOrdinal}. {v.stepCode}</span>
                <span className={v.decision === "APPROVED" ? "text-teal-700" : "text-red-700"}>{v.decision}</span>
                <span className="text-slate-500">{v.signerDisplayName}</span>
                <span className="ml-auto text-slate-400">{frDateTime(v.decidedAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

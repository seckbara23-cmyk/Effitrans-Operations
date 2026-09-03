/**
 * The refusal an operator reads when « Transmettre au Transit » cannot proceed.
 * ---------------------------------------------------------------------------
 * ONE presentation for BOTH surfaces — the dossier page and the « Processus
 * officiel Effitrans » screen — fed by ONE evaluator
 * (`evaluateTransitHandoffReadiness`). The UAT that produced this component
 * failed the other way round: the process screen offered an enabled button and
 * then showed « L'action a échoué. Réessayez. », while the dossier page could
 * already name the reason. Two screens, two truths, one server rule.
 *
 * What it shows, and nothing more:
 *   • every prerequisite currently unmet — all of them, not the first;
 *   • where the official dependency graph makes it certain, the step to do
 *     FIRST. That line is omitted entirely when the graph cannot decide, since
 *     sending an operator to the wrong step is worse than sending them nowhere.
 *
 * Every sentence here comes from the evaluator and the process registry. This
 * file writes no step name, no number and no document name of its own.
 */
import type { HandoffPrerequisite, ActionableStep } from "@/lib/process/intake";

export function HandoffPrerequisites({
  unmet,
  firstActionable,
  title = "Transmission au Transit impossible — prérequis non satisfaits :",
}: {
  unmet: HandoffPrerequisite[];
  firstActionable: ActionableStep | null;
  title?: string;
}) {
  if (unmet.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" role="alert">
      <p className="text-xs font-medium text-amber-900">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
        {unmet.map((p) => (
          <li key={p.code}>{p.labelFr}</li>
        ))}
      </ul>
      {firstActionable && (
        <div className="mt-2 border-t border-amber-200 pt-2">
          <p className="text-xs font-medium text-amber-900">Action à effectuer en premier :</p>
          <p className="mt-0.5 text-xs text-amber-800">
            Étape {firstActionable.stepNumber} « {firstActionable.labelFr} »
          </p>
        </div>
      )}
    </div>
  );
}

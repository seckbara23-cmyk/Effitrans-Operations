"use client";

/**
 * The official process, where the work is — a compact card on the dossier page.
 * ---------------------------------------------------------------------------
 * THIS IS NOT A SECOND WORKFLOW. It renders a verdict the server computed with
 * the same evaluator `/process` and `/queues` read, and its buttons are the
 * SAME two server actions — `queueStartStep` → `activateStep`,
 * `queueSubmitStep` → `submitStep`. It decides nothing. Nothing about a step
 * changes because it was pressed here rather than two pages away.
 *
 * WHY IT EXISTS. Operators were navigating from the dossier to the 26-step page
 * and back to perform work that belongs to the section they were already
 * looking at. The 26 steps stay on `/process`, which remains the complete view;
 * this shows the one or two that concern the reader, in the part of the dossier
 * where that work actually happens, with a link back for everything else.
 *
 * WHAT IT DELIBERATELY DOES NOT COLLAPSE. Affecter, Démarrer and Terminer are
 * three different governance acts with three different authorities and three
 * different audit rows. They may sit next to each other; they never become one
 * « advance » button.
 *
 * AND WHAT IT MUST NEVER SHOW. A button the server would refuse. Every
 * condition comes from `StepEligibility`; there is no `hasPermission` here, no
 * fetch, and no state of its own beyond what a transition needs.
 */
import Link from "next/link";
import { StepActions } from "./step-actions";
import type { StepEligibility } from "@/lib/process/step-eligibility";
import type { ContextualStatus } from "@/lib/process/contextual/view";
import type { ViewerRelation, WorkKind } from "@/lib/process/work-model";

export type ContextualStepCardProps = {
  fileId: string;
  stepKey: string;
  stepNumber: number | null;
  labelFr: string;
  /** Total steps in the official process, for « Étape 6 sur 26 ». */
  totalSteps: number;
  status: ContextualStatus;
  /** Server-computed, from the SAME function the queue and /process read. */
  eligibility: StepEligibility;
  /** Who holds it, already resolved. Null when nothing is claimed. */
  assigneeLabel: string | null;
  /** The department queue this step belongs to — the action's revalidation scope. */
  queueKey: string | null;
  /** Deep link to this exact step on the official-process page. */
  anchor: string;
  /**
   * Where this sits in the canonical partition (OPS-NEXT-ACTION-01). Carried so
   * a card cannot describe itself as current work while the dossier header —
   * reading the same model — calls it parallel.
   */
  kind: WorkKind;
  /** What the READER may do. Drives the heading, never the buttons. */
  viewer: ViewerRelation;
};

/** The heading an operator reads first. Ratified vocabulary, §13. */
const HEADING: Record<ViewerRelation, string> = {
  yours_active: "Votre action",
  yours_available: "À votre tour",
  someone_else: "Travail en cours",
  observer: "Suivi",
};

const KIND_NOTE: Partial<Record<WorkKind, string>> = {
  parallel: "Action parallèle — peut être menée en même temps que l'étape en cours.",
  upcoming: "À venir — les prérequis ne sont pas encore réunis.",
  not_applicable: "Sans objet sur ce dossier.",
};

export function ContextualStepCard({
  fileId,
  stepKey,
  stepNumber,
  labelFr,
  totalSteps,
  status,
  eligibility,
  assigneeLabel,
  queueKey,
  anchor,
  kind,
  viewer,
}: ContextualStepCardProps) {
  // Outstanding requirements, in the two registers the leniency doctrine
  // ratified: what genuinely stops the step, and what should be completed while
  // work continues. Both are the server's classification, not this file's.
  const blocking = eligibility.requirements.filter((r) => r.blocking);
  const advisory = eligibility.requirements.filter((r) => !r.blocking);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            {HEADING[viewer]}
          </p>
          <p className="text-xs text-slate-500">
            {stepNumber ? `Étape ${stepNumber} sur ${totalSteps}` : "Étape hors séquence"}
          </p>
          <h3 className="truncate text-sm font-semibold text-navy-900">{labelFr}</h3>
        </div>
        {/* Never colour alone: the word carries the state. */}
        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${status.tone}`}>
          {status.labelFr}
        </span>
      </div>

      {assigneeLabel && (
        <p className="mt-1 text-xs text-slate-600">En cours : {assigneeLabel}</p>
      )}

      {KIND_NOTE[kind] && <p className="mt-1 text-[11px] text-slate-500">{KIND_NOTE[kind]}</p>}

      {/* « Action requise » — what the process will not pass without. */}
      {blocking.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {blocking.map((r) => (
            <li key={r.key} className="text-[11px] text-amber-800">
              {r.messageFr}
            </li>
          ))}
        </ul>
      )}

      {/* « Information à compléter » — visible, tracked, and not in the way. */}
      {advisory.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {advisory.map((r) => (
            <li key={r.key} className="text-[11px] text-slate-500">
              {r.messageFr}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-xs">
          {/* Stable step anchor, never a DOM position. */}
          <Link href={anchor} className="text-teal-700 hover:underline">
            Voir cette étape
          </Link>
          <Link href={`/files/${fileId}/process`} className="text-teal-700 hover:underline">
            Voir le processus complet
          </Link>
        </div>

        {/* The SAME component the official-process page mounts. Reused rather
            than reimplemented: a second copy is how two surfaces start
            offering different buttons on the same verdict. */}
        {queueKey && (
          <StepActions
            fileId={fileId}
            queueKey={queueKey}
            stepKey={stepKey}
            eligibility={eligibility}
            assigneeLabel={null}
          />
        )}
      </div>
    </section>
  );
}

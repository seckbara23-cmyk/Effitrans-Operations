/**
 * « Qu'est-ce que je dois faire maintenant ? » — the first thing on a dossier.
 * ---------------------------------------------------------------------------
 * OPS-UAT-CONVERGENCE-01 §12/§13. A SERVER component, and it decides nothing:
 * every verdict comes from `getDossierWork`, which is the same model the
 * journey panel, the contextual cards and the department queue read.
 *
 * WHAT AN OPERATOR SHOULD BE ABLE TO ANSWER WITHOUT SCROLLING:
 *   1. what is happening now, and who holds it
 *   2. whether any of it is THEIRS
 *   3. what may proceed in parallel
 *   4. what is merely to be completed, and is not stopping anything
 *   5. what comes next
 *
 * ROLE-AWARENESS IS NOT AUTHORITY. « Votre action » is a heading; the buttons
 * underneath are the same `StepActions` component `/process` and `/queues`
 * mount, calling the same two server actions, which re-check permission,
 * ownership, custody, prerequisites, evidence and state on every call. A
 * SYSTEM_ADMIN reading this page sees « Travail en cours » and no button,
 * because broad permissions do not make an administrator every operational
 * maker — the ownership rule refuses them and this reflects that refusal
 * rather than inventing one of its own.
 *
 * AND IT NEVER INVENTS A SEQUENCE. When several actions are legitimately live
 * the three lists are shown as three lists. Forcing them into one « prochaine
 * action » is what let a Transport step at position 0 of an unsorted array
 * speak for a dossier whose Déclarant was mid-declaration.
 */
import Link from "next/link";
import { ContextualStepCard } from "./contextual-step-card";
import { queueForStep } from "@/lib/process/queues/registry";
import { contextualStatus } from "@/lib/process/contextual/view";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { SERVICE_LABEL_FR, SERVICE_KEYS, scopeLabelFr } from "@/lib/process/service-scope";
import type { DossierWorkView } from "@/lib/process/work-service";
import type { WorkItem } from "@/lib/process/work-model";

const TOTAL_STEPS = EFFITRANS_PROCESS.filter((s) => typeof s.stepNumber === "number").length;

/** One line of secondary work: a label, a state and a link. Never a button. */
function Line({ item, fileId }: { item: WorkItem; fileId: string }) {
  const status = contextualStatus(item.state, item.eligibility);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <span className="min-w-0 flex-1 truncate text-slate-700">
        {item.stepNumber ? `${item.stepNumber}. ` : ""}
        {item.labelFr}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {item.assigneeLabel && <span className="text-[11px] text-slate-500">{item.assigneeLabel}</span>}
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.tone}`}>
          {status.labelFr}
        </span>
        <Link
          href={`/files/${fileId}/process#step-${item.stepKey}`}
          className="text-[11px] text-teal-700 hover:underline"
        >
          Voir
        </Link>
      </span>
    </li>
  );
}

function Group({
  title,
  hint,
  items,
  fileId,
}: {
  title: string;
  hint?: string;
  items: readonly WorkItem[];
  fileId: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      <ul className="mt-1 divide-y divide-slate-100 text-xs">
        {items.map((i) => (
          <Line key={i.stepKey} item={i} fileId={fileId} />
        ))}
      </ul>
    </div>
  );
}

export function DossierWorkSummary({
  fileId,
  view,
}: {
  fileId: string;
  view: DossierWorkView | null;
}) {
  if (!view?.hasInstance) return null;
  const { work, scope } = view;
  const primary = work.primary;

  // The primary card is drawn with the FULL step card — same component, same
  // buttons, same server actions — so the top of the dossier and the section it
  // belongs to cannot offer different things.
  const primaryCard = primary
    ? {
        fileId,
        stepKey: primary.stepKey,
        stepNumber: primary.stepNumber,
        labelFr: primary.labelFr,
        totalSteps: TOTAL_STEPS,
        status: contextualStatus(primary.state, primary.eligibility),
        eligibility: primary.eligibility,
        assigneeLabel: primary.assigneeLabel,
        queueKey: queueForStep(primary.stepKey),
        anchor: `/files/${fileId}/process#step-${primary.stepKey}`,
        kind: primary.kind,
        viewer: primary.viewer,
      }
    : null;

  // Everything current except the one already drawn in full.
  const otherCurrent = work.current.filter((i) => i.stepKey !== primary?.stepKey);

  // « Information à compléter » — the ratified second register. Gathered across
  // the whole dossier so an operator sees what is outstanding without opening
  // every section, and deliberately kept OUT of the blocking list: none of it
  // stops the work.
  const advisory = [...work.current, ...work.parallel, ...work.blocked].flatMap((i) =>
    i.eligibility.requirements
      .filter((r) => !r.blocking)
      .map((r) => ({ key: `${i.stepKey}::${r.key}`, messageFr: r.messageFr })),
  );

  const outOfScope = SERVICE_KEYS.filter((k) => scope[k] === "NOT_APPLICABLE");

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy-900">Votre travail sur ce dossier</h2>
        <span className="text-[11px] text-slate-500">
          Services : {scopeLabelFr(scope)} · {work.progress.officialCompleted}/
          {work.progress.officialTotal} étapes officielles
          {work.progress.activitiesTotal > 0 &&
            ` · ${work.progress.activitiesCompleted}/${work.progress.activitiesTotal} activités parallèles`}
        </span>
      </div>

      {primaryCard ? (
        <ContextualStepCard {...primaryCard} />
      ) : (
        <p className="text-xs text-slate-600">
          Aucune action ouverte sur ce dossier pour le moment.
        </p>
      )}

      <Group
        title="Aussi en cours"
        items={otherCurrent}
        fileId={fileId}
      />
      <Group
        title="Actions parallèles disponibles"
        hint="Peuvent être menées en même temps que l'étape en cours."
        items={work.parallel}
        fileId={fileId}
      />
      <Group
        title="Bloquées"
        hint="Un prérequis ratifié n'est pas satisfait."
        items={work.blocked}
        fileId={fileId}
      />
      <Group title="À venir" items={work.upcoming.slice(0, 3)} fileId={fileId} />

      {advisory.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Informations à compléter
          </p>
          <ul className="mt-1 space-y-0.5">
            {advisory.map((a) => (
              <li key={a.key} className="text-[11px] text-slate-600">
                {a.messageFr}
              </li>
            ))}
          </ul>
        </div>
      )}

      {outOfScope.length > 0 && (
        <p className="text-[11px] text-slate-500">
          Sans objet sur ce dossier :{" "}
          {outOfScope.map((k) => SERVICE_LABEL_FR[k]).join(", ")} — service non demandé.
          {work.notApplicable.length > 0 &&
            ` ${work.notApplicable.length} étape(s) concernée(s).`}
        </p>
      )}

      <p className="text-[11px] text-slate-500">
        Le processus officiel complet — 26 étapes et 3 activités parallèles —
        reste sur{" "}
        <Link href={`/files/${fileId}/process`} className="text-teal-700 hover:underline">
          la page Processus
        </Link>
        .
      </p>
    </section>
  );
}

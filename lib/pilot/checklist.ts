/**
 * Guided pilot checklist (Phase 5.0E-2B, Deliverable 4). PURE.
 * ---------------------------------------------------------------------------
 * The 26-step run-through, as a thing a person can actually follow: for each step,
 * WHO does it, WHERE they go, WHAT they do, WHAT must then be true, and WHO gets it
 * next.
 *
 * DERIVED from the 26-step registry, not transcribed from it. If the process is ever
 * amended, this checklist changes with it — a transcribed checklist would quietly
 * start testing a process that no longer exists.
 *
 * Contains NO credentials, NO customer data and NO secrets. It is a procedure, not a
 * runbook with passwords in it.
 */
import { EFFITRANS_PROCESS, PARALLEL_ACTIVITIES, MAKER_CHECKER_PAIRS } from "@/lib/process/effitrans-process";
import { QUEUES } from "@/lib/process/queues/registry";
import { ROLE_MAPPINGS } from "@/lib/process/roles";
import { roleLabel } from "@/lib/navigation/roles";
import type { ProcessRole } from "@/lib/process/types";

export type ChecklistItem = {
  stepNumber: number;
  stepKey: string;
  /** The official French label. Staff-facing, never a raw key. */
  label: string;
  phase: string;
  /** Who performs it, in French. Never a raw role code. */
  actorLabel: string;
  /** The tenant role a pilot user must actually hold. */
  actorRoleCode: string | null;
  /** Where they go. The real route, from the queue registry. */
  route: string;
  /** What must be true afterwards for this step to count as passed. */
  expectedResult: string;
  /** Evidence a verifier can actually look at. */
  evidence: string[];
  /** Who the dossier goes to next. */
  nextActorLabel: string | null;
  /** True when this step is one half of a maker-checker pair. */
  makerChecker: boolean;
  /** True when this step runs on the parallel customs/transport branch. */
  parallel: boolean;
  /** Set when the step CANNOT be tested — with the honest reason. */
  blocked: string | null;
};

function routeForRole(official: ProcessRole): string {
  const q = QUEUES.find((x) => x.officialRole === official);
  return q ? `/queues/${q.key}` : "/my-work";
}

function tenantRoleFor(official: ProcessRole): string | null {
  const m = ROLE_MAPPINGS.find((x) => x.officialRole === official);
  return m?.tenantRole ?? null;
}

function actorLabelFor(official: ProcessRole): string {
  const code = tenantRoleFor(official);
  return (code && roleLabel(code)) ?? official.replace(/_/g, " ").toLowerCase();
}

const PARALLEL_KEYS = new Set(PARALLEL_ACTIVITIES.map((p) => p.key));
const MAKER_CHECKER_KEYS = new Set(
  MAKER_CHECKER_PAIRS.flatMap((p) => [p.preparerStep, p.validatorStep]),
);

export function buildPilotChecklist(): ChecklistItem[] {
  return EFFITRANS_PROCESS.map((step, i) => {
    const next = EFFITRANS_PROCESS[i + 1];
    const tenantRole = tenantRoleFor(step.role);

    // The honest part. Seven official roles have no tenant role behind them (the
    // 5.0A finding). A step owned by an unmapped role cannot be executed by a real
    // user, and the checklist must SAY so rather than present an untestable line as
    // if it were testable.
    const blocked = tenantRole
      ? null
      : `Rôle officiel « ${step.role} » non associé à un rôle tenant — étape non exécutable par un utilisateur réel.`;

    const evidence: string[] = [];
    if (step.requiredDocuments?.length) {
      evidence.push(`Documents requis : ${step.requiredDocuments.join(", ")}`);
    }
    if (MAKER_CHECKER_KEYS.has(step.key)) {
      evidence.push("Le validateur DOIT être une personne différente du préparateur (refus attendu sinon)");
    }
    if (PARALLEL_KEYS.has(step.key)) {
      evidence.push("Branche parallèle : la convergence est requise avant la porte d'enlèvement");
    }
    evidence.push("Une entrée d'audit existe, horodatée, avec l'acteur");

    return {
      stepNumber: step.stepNumber,
      stepKey: step.key,
      label: step.labelFr,
      phase: step.phase,
      actorLabel: actorLabelFor(step.role),
      actorRoleCode: tenantRole,
      route: routeForRole(step.role),
      expectedResult: step.internalLabel,
      evidence,
      nextActorLabel: next ? actorLabelFor(next.role) : null,
      makerChecker: MAKER_CHECKER_KEYS.has(step.key),
      parallel: PARALLEL_KEYS.has(step.key),
      blocked,
    };
  });
}

/** What the pilot can and cannot actually prove, stated up front. */
export function checklistCoverage(items: ChecklistItem[]) {
  const executable = items.filter((i) => !i.blocked);
  return {
    total: items.length,
    executable: executable.length,
    blocked: items.length - executable.length,
    blockedSteps: items.filter((i) => i.blocked).map((i) => ({ number: i.stepNumber, why: i.blocked! })),
    makerCheckerSteps: items.filter((i) => i.makerChecker).map((i) => i.stepNumber),
    parallelSteps: items.filter((i) => i.parallel).map((i) => i.stepNumber),
  };
}

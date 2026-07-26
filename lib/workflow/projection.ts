/**
 * THE canonical dossier projection (Phase WES-2) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * One function. One answer. Every screen, dashboard, task list, progress bar and
 * department reads THIS and computes nothing of its own.
 *
 * Before WES-2 the platform answered "where is this dossier and how far along is
 * it?" in seven different places — a 15-step tracker, a 26-step journey summary,
 * a UI-level percentage, a 10-stage portal timeline, a hardcoded driver 0/50/100,
 * and a milestone roll-up — which is why UAT saw four different numbers for one
 * dossier and watched a dossier in transport announce « Préparer et déclarer en
 * douane ».
 *
 * WHAT THIS OWNS (and nothing else may compute):
 *   • current lifecycle stage        • progress
 *   • current / responsible dept     • completed stages
 *   • next action                    • pending stages
 *
 * TWO PROPERTIES THIS GUARANTEES
 *
 * 1. MONOTONIC (ADR-WES-010). The stage is ratcheted: it is the FURTHEST stage
 *    the dossier has evidence of having reached, and it never decreases. When the
 *    raw frontier falls behind — a newly-required document re-opens documentation
 *    on a dossier already in transport — the stage HOLDS and the earlier work
 *    surfaces as a blocker overlay:
 *
 *        Stage: Transport · Bloqué · Responsable : Documentation
 *
 *    A completed stage is therefore immutable: nothing downstream can make it
 *    incomplete again.
 *
 * 2. PURE (WES-2 §9). This summarises FACTS. No SLA, no routing, no ownership
 *    policy, no document policy, no I/O, and — deliberately — no task input at
 *    all: workflow determines tasks, never the reverse.
 *
 * REUSE. The 15-step fact derivation (`getDossierLifecycle`) and the customs /
 * transport rank tables are the EXISTING, tested logic and are reused verbatim.
 * This module adds the ladder, the ratchet and the one formula on top; it does
 * not re-derive a single fact.
 */
import {
  CUSTOMS_RANK,
  TRANSPORT_RANK,
  getDossierLifecycle,
  type Department,
  type DossierLifecycle,
  type LifecycleInput,
  type LifecycleNextAction,
  type LifecycleStep,
} from "@/lib/files/lifecycle";
import {
  CANONICAL_STAGES,
  stageByOrdinal,
  stageForDepartment,
  type CanonicalStageDef,
  type CanonicalStageKey,
} from "./stages";

export type CanonicalStageState = "completed" | "current" | "blocked" | "pending" | "skipped";

export type ProjectedStage = CanonicalStageDef & { state: CanonicalStageState };

export type CanonicalProjection = {
  /** The full ladder, every stage carrying its state. */
  stages: ProjectedStage[];
  /** WHERE THE DOSSIER IS. Ratcheted — never moves backwards. */
  currentStage: CanonicalStageKey;
  /** The department of the current stage. */
  currentDepartment: Department;
  /**
   * WHO MUST ACT NOW. Usually the current stage's department; when the ratchet is
   * holding, this is the earlier department the dossier is waiting on.
   */
  responsibleDepartment: Department | null;
  /** True when work is outstanding at a department earlier than the current stage. */
  blocked: boolean;
  /** THE progress number. Computed here and nowhere else. */
  progressPercent: number;
  completedStages: CanonicalStageKey[];
  pendingStages: CanonicalStageKey[];
  /** The single next action. Never hardcoded, never inferred by a consumer. */
  nextAction: LifecycleNextAction | null;
  blockers: { key: string; label: string; reason: string }[];
  /** How the ratchet resolved — for surfaces that explain themselves. */
  ratchet: {
    /** Furthest stage with evidence of having been reached. */
    reachedStage: CanonicalStageKey;
    /** Stage the raw frontier would have reported. */
    frontierStage: CanonicalStageKey;
    /** True when the frontier fell behind and the ratchet held the line. */
    held: boolean;
  };
  /** The 15-step detail, for surfaces that render granularity. Facts only. */
  steps: LifecycleStep[];
};

/** A department's applicable steps are all done (completed or deliberately skipped). */
function departmentDone(steps: LifecycleStep[], department: Department): boolean {
  const own = steps.filter((s) => s.department === department);
  const applicable = own.filter((s) => s.status !== "skipped");
  if (own.length === 0) return false;
  if (applicable.length === 0) return true; // every step skipped ⇒ nothing to do
  return applicable.every((s) => s.status === "completed");
}

/** A stage whose whole department is inapplicable to this dossier (e.g. customs on TRP). */
function departmentSkipped(steps: LifecycleStep[], department: Department): boolean {
  const own = steps.filter((s) => s.department === department);
  return own.length > 0 && own.every((s) => s.status === "skipped");
}

/**
 * The RATCHET floor: the furthest stage this dossier has evidence of having
 * reached. Read only from facts that cannot legitimately go backwards.
 *
 * A BLOCKED customs or transport record counts as REACHED — you cannot be
 * blocked in a department you never entered, and treating a blocker as a
 * regression is the exact defect ADR-WES-010 forbids.
 */
function reachedOrdinal(input: LifecycleInput): number {
  let reached = 0; // draft

  if (input.file.status !== "DRAFT") reached = Math.max(reached, 1); // open
  if (input.documents.some((d) => d.status === "APPROVED")) reached = Math.max(reached, 2);

  const cs = input.customs?.status ?? null;
  if (cs && ((CUSTOMS_RANK[cs] ?? 0) >= 1 || cs === "BLOCKED")) reached = Math.max(reached, 3);

  const ts = input.transport?.status ?? null;
  if (ts && ((TRANSPORT_RANK[ts] ?? 0) >= 1 || ts === "BLOCKED")) reached = Math.max(reached, 4);
  if (input.podApproved) reached = Math.max(reached, 4);

  if (input.invoices.some((i) => i.status !== "DRAFT" && i.status !== "VOID")) reached = Math.max(reached, 5);
  if (input.file.status === "CLOSED") reached = Math.max(reached, 6);

  return reached;
}

/**
 * Build the canonical projection for one dossier.
 *
 * Takes the SAME input the existing lifecycle tracker takes, so no consumer needs
 * new data plumbing to migrate onto it.
 */
export function buildCanonicalProjection(input: LifecycleInput): CanonicalProjection {
  // The facts. Existing, tested derivation — reused, never re-implemented.
  const lifecycle: DossierLifecycle = getDossierLifecycle(input);

  const floor = reachedOrdinal(input);
  const frontierStage = lifecycle.currentDepartment
    ? stageForDepartment(lifecycle.currentDepartment)
    : stageByOrdinal(input.file.status === "CLOSED" ? 6 : floor);

  // THE RATCHET: the stage is the furthest of what evidence proves and what the
  // frontier reports. It can rise; it cannot fall.
  const currentOrdinal = Math.max(floor, frontierStage.ordinal);
  const current = stageByOrdinal(currentOrdinal);
  const held = frontierStage.ordinal < currentOrdinal;

  const stages: ProjectedStage[] = CANONICAL_STAGES.map((stage) => {
    if (departmentSkipped(lifecycle.steps, stage.department)) {
      return { ...stage, state: "skipped" as const };
    }

    // IMMUTABILITY (WES-2 §7): anything before the ratcheted stage is completed
    // and stays completed — a later module can never reopen it.
    if (stage.ordinal < currentOrdinal) return { ...stage, state: "completed" as const };

    if (stage.ordinal === currentOrdinal) {
      const done = departmentDone(lifecycle.steps, stage.department);
      // Done, but nothing later has started yet ⇒ still the current stage.
      if (held || lifecycle.blockers.length > 0) return { ...stage, state: "blocked" as const };
      return { ...stage, state: done ? ("completed" as const) : ("current" as const) };
    }

    return { ...stage, state: "pending" as const };
  });

  const applicable = stages.filter((s) => s.state !== "skipped");
  const completed = applicable.filter((s) => s.state === "completed");

  // THE ONE PROGRESS FORMULA — completed applicable stages ÷ applicable stages.
  // Blocked never subtracts: a blocked stage is simply not yet completed.
  const progressPercent =
    applicable.length === 0 ? 0 : Math.round((completed.length / applicable.length) * 100);

  return {
    stages,
    currentStage: current.key,
    currentDepartment: current.department,
    // When the ratchet holds, the dossier sits at the later stage but the work is
    // owed by the earlier department — that is the ADR-WES-010 rendering.
    responsibleDepartment: lifecycle.currentDepartment ?? null,
    blocked: held || lifecycle.blockers.length > 0,
    progressPercent,
    completedStages: completed.map((s) => s.key),
    pendingStages: applicable.filter((s) => s.state === "pending").map((s) => s.key),
    nextAction: lifecycle.nextAction,
    blockers: lifecycle.blockers,
    ratchet: { reachedStage: stageByOrdinal(floor).key, frontierStage: frontierStage.key, held },
    steps: lifecycle.steps,
  };
}

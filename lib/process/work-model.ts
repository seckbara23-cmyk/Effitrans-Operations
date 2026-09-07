/**
 * THE canonical answer to « qu'est-ce que je dois faire maintenant ? » — PURE.
 * ---------------------------------------------------------------------------
 * OPS-NEXT-ACTION-01, ratified 2026-09-07.
 *
 * ── THE DEFECT THIS REPLACES, as production showed it on EFT-IMP-2026-00011 ──
 * Seven surfaces answered « what happens next » and they answered differently,
 * because they answered from different sources:
 *
 *   1. `summarizeJourney` → « Prochaine action : Service Transport — affecter
 *      le véhicule ». It took `model.activeSteps[0]`, and `activeSteps` is
 *      every OPEN node in whatever order the loader returned — AVAILABLE mixed
 *      with ACTIVE, numbered steps mixed with parallel activities, no ordering
 *      at all. Four nodes qualified on 00011; the first one won. The SAME
 *      object already held a second answer: `currentPhase` and `clientStage`
 *      come from `frontier`, which IS sorted by step number.
 *   2. `getDossierLifecycle` → a second « Prochaine action », from documents
 *      and records rather than from the process engine.
 *   3. the contextual cards → correct, but only ever per section.
 *   4. the department queue → `node.completionRule`, an internal code.
 *   5. the transport workspace → its own sentence from the pickup gate.
 *   6/7. risk and SLA → theirs.
 *
 * So a Déclarant with step 6 ACTIVE and assigned to him read « Détenteur :
 * personne — non attribué » and « Prochaine action : Service Transport ».
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * ONE partition of a dossier's nodes into the five dispositions Effitrans
 * ratified, and ONE sentence derived from it. Every surface that says what
 * happens next reads THIS; none of them re-derives it.
 *
 *   CURRENT         work somebody may legitimately perform now
 *   PARALLEL        legitimate work that may proceed concurrently, in another
 *                   branch of the graph
 *   UPCOMING        known future work whose prerequisites are not satisfied
 *   BLOCKED         applicable work stopped by a ratified hard prerequisite
 *   NOT_APPLICABLE  the service was not contracted, or the step was skipped
 *
 * ── THE RULE THAT MATTERS MOST ──────────────────────────────────────────────
 * « The UI must not label an upcoming future action as Prochaine action if an
 * ACTIVE owned action still exists unless the business process explicitly
 * allows parallel execution. » So `nextActionFr` reads CURRENT first and only
 * falls through when there is nothing current, and when several actions are
 * legitimately live at once the model SAYS SO rather than inventing a sequence
 * the graph does not contain.
 *
 * ── AND THE COUNT ───────────────────────────────────────────────────────────
 * 26 OFFICIAL STEPS + 3 PARALLEL ACTIVITIES = 29 execution rows. They are
 * counted apart, always. A parallel activity must never inflate official
 * progress and 29 must never be called « 29 étapes officielles ».
 *
 * PURE: no I/O, no registry lookups beyond the pure ones, no decisions of its
 * own about authority. It partitions verdicts `evaluateStepAction` already
 * made.
 */
import type { ParallelGroup } from "./types";
import type { StepEligibility } from "./step-eligibility";

export type WorkKind = "current" | "parallel" | "upcoming" | "blocked" | "not_applicable";

/** How the READER relates to this work — the whole point of a contextual UI. */
export type ViewerRelation =
  /** ACTIVE, theirs, and they may finish it. */
  | "yours_active"
  /** Open and claimable by them right now. */
  | "yours_available"
  /** Somebody else holds it. */
  | "someone_else"
  /** Neither theirs nor claimable — status, never a button. */
  | "observer";

export type WorkNode = {
  stepKey: string;
  /** 1..26, or null for one of the three parallel activities. */
  stepNumber: number | null;
  labelFr: string;
  state: string;
  branch: ParallelGroup;
  /** French role label, never a role CODE. */
  ownerLabelFr: string | null;
  /** Who holds it, when somebody does. */
  assigneeLabel: string | null;
  eligibility: StepEligibility;
};

export type WorkItem = WorkNode & {
  kind: WorkKind;
  viewer: ViewerRelation;
};

export type DossierProgress = {
  /** Official steps only. The denominator is always 26. */
  officialCompleted: number;
  officialTotal: number;
  /** Official steps out of scope or deliberately skipped — never « done ». */
  officialNotApplicable: number;
  /** The three parallel activities, counted apart. Never folded into the 26. */
  activitiesCompleted: number;
  activitiesTotal: number;
};

export type DossierWork = {
  current: WorkItem[];
  parallel: WorkItem[];
  upcoming: WorkItem[];
  blocked: WorkItem[];
  notApplicable: WorkItem[];
  /** The single item to draw first FOR THIS READER, or null. */
  primary: WorkItem | null;
  /** The one canonical sentence. Consumed by every « Prochaine action ». */
  nextActionFr: string;
  /** Who to chase, in French. Null when nothing is live. */
  currentOwnerFr: string | null;
  progress: DossierProgress;
};

const TERMINAL_DONE = new Set(["COMPLETED", "APPROVED"]);
const OUT_OF_PLAY = new Set(["SKIPPED", "CANCELLED"]);
/** Live and somebody's hands are on it. */
const IN_HAND = new Set(["ACTIVE", "SUBMITTED"]);

/** 26, from the registry — passed in so this file stays free of imports it does not need. */
export type WorkInput = {
  nodes: readonly WorkNode[];
  officialTotal: number;
  activitiesTotal: number;
};

/**
 * Whose work is this, from where the reader stands?
 *
 * ORDER IS LOAD-BEARING. « Yours » is established by what the reader may
 * actually DO — `canSubmit`/`canStart`, the same verdicts the server enforces —
 * before anything is inferred from a role. A SYSTEM_ADMIN reading a Déclarant's
 * step is an observer here precisely because the ownership rule refuses them,
 * and broad permissions must never turn an administrator into every operational
 * maker.
 */
function relation(n: WorkNode): ViewerRelation {
  const e = n.eligibility;
  if (e.canSubmit && IN_HAND.has(n.state)) return "yours_active";
  if (e.canStart) return "yours_available";
  if (e.claimedByAnother || n.assigneeLabel !== null) return "someone_else";
  // Owned by their role but not offerable right now (custody, a prerequisite,
  // an outstanding hard requirement): still theirs to read about.
  return e.isOwner && e.mayAct ? "yours_available" : "observer";
}

/**
 * Which disposition is this node in?
 *
 * `frontierBranch` is the branch holding the lowest-numbered live node. Open
 * work in THAT branch is the current thread; open work anywhere else is
 * genuinely concurrent, which is what the registry's `parallelGroup` has always
 * meant and what a linear list has always hidden.
 */
function kindOf(n: WorkNode, frontierBranch: ParallelGroup | null): WorkKind {
  if (n.eligibility.notApplicable || OUT_OF_PLAY.has(n.state)) return "not_applicable";
  if (TERMINAL_DONE.has(n.state)) return "current"; // filtered out by the caller
  if (n.state === "BLOCKED") return "blocked";
  if (n.state === "PENDING") return "upcoming";
  // AVAILABLE / ACTIVE / SUBMITTED / REJECTED / UNVERIFIED_HISTORICAL.
  if (IN_HAND.has(n.state)) return "current";
  if (n.state !== "AVAILABLE") return "upcoming";
  // AVAILABLE, and reachable. Custody and a hard prerequisite are the two ways
  // an available step is genuinely stopped rather than merely somebody else's.
  const e = n.eligibility;
  const custodyStopped =
    e.custody === "awaiting_reception" || e.custody === "awaiting_transmission";
  const hardStopped = e.requirements.some((r) => r.blocking);
  if (custodyStopped || hardStopped) return "blocked";
  return frontierBranch === null || n.branch === frontierBranch ? "current" : "parallel";
}

export function buildDossierWork(input: WorkInput): DossierWork {
  const live = input.nodes.filter(
    (n) => !TERMINAL_DONE.has(n.state) && !OUT_OF_PLAY.has(n.state) && !n.eligibility.notApplicable,
  );

  // The frontier: the lowest-numbered node with hands on it, else the
  // lowest-numbered live node at all. A parallel ACTIVITY (stepNumber null)
  // never sets the frontier — it is by definition off the main thread.
  const numbered = (n: WorkNode) => n.stepNumber ?? Number.MAX_SAFE_INTEGER;
  const inHand = live.filter((n) => IN_HAND.has(n.state)).sort((a, b) => numbered(a) - numbered(b));
  const anyLive = [...live].sort((a, b) => numbered(a) - numbered(b));
  const frontier = inHand[0] ?? anyLive[0] ?? null;
  const frontierBranch = frontier?.branch ?? null;

  const items: WorkItem[] = input.nodes.map((n) => ({
    ...n,
    kind: kindOf(n, frontierBranch),
    viewer: relation(n),
  }));

  const done = (n: WorkNode) => TERMINAL_DONE.has(n.state);
  const bucket = (k: WorkKind) =>
    items
      .filter((i) => i.kind === k && (k === "not_applicable" || !done(i)))
      .sort((a, b) => numbered(a) - numbered(b));

  const current = bucket("current");
  const parallelWork = bucket("parallel");
  const upcoming = bucket("upcoming");
  const blocked = bucket("blocked");
  const notApplicable = bucket("not_applicable");

  // VIEWER-AWARE PRIMARY. Something they can finish beats something they can
  // start; a current action beats a parallel one. When nothing is theirs the
  // primary is still the current work — as STATUS, which is what
  // `viewer: "someone_else" | "observer"` tells the surface to render.
  const byPreference = [...current, ...parallelWork, ...blocked];
  const primary =
    byPreference.find((i) => i.viewer === "yours_active")
    ?? byPreference.find((i) => i.viewer === "yours_available")
    ?? current[0]
    ?? parallelWork[0]
    ?? blocked[0]
    ?? null;

  const officialNodes = input.nodes.filter((n) => n.stepNumber !== null);
  const activityNodes = input.nodes.filter((n) => n.stepNumber === null);
  const progress: DossierProgress = {
    officialCompleted: officialNodes.filter((n) => TERMINAL_DONE.has(n.state)).length,
    officialTotal: input.officialTotal,
    // SKIPPED is NOT completed. It keeps its own column so « 5/26 » never
    // silently absorbs a step nobody performed.
    officialNotApplicable: officialNodes.filter(
      (n) => OUT_OF_PLAY.has(n.state) || n.eligibility.notApplicable,
    ).length,
    activitiesCompleted: activityNodes.filter((n) => TERMINAL_DONE.has(n.state)).length,
    activitiesTotal: input.activitiesTotal,
  };

  return {
    current,
    parallel: parallelWork,
    upcoming,
    blocked,
    notApplicable,
    primary,
    nextActionFr: nextActionSentence({ current, parallel: parallelWork, blocked, upcoming }),
    currentOwnerFr: current[0]?.assigneeLabel ?? current[0]?.ownerLabelFr ?? null,
    progress,
  };
}

/**
 * ONE sentence. Current work outranks everything, always.
 *
 * When several actions are legitimately live the sentence says how many rather
 * than picking one and presenting it as the sequence — forcing a false single
 * order onto a graph that contains parallel work is the defect §10 names.
 */
export function nextActionSentence(w: {
  current: readonly WorkItem[];
  parallel: readonly WorkItem[];
  blocked: readonly WorkItem[];
  upcoming: readonly WorkItem[];
}): string {
  if (w.current.length > 0) {
    const first = w.current[0].labelFr;
    if (w.current.length === 1) return first;
    return `${first} — et ${w.current.length - 1} autre(s) action(s) en cours`;
  }
  if (w.parallel.length > 0) return w.parallel[0].labelFr;
  if (w.blocked.length > 0) {
    return `${w.blocked[0].labelFr} — ${w.blocked[0].eligibility.reasonFr ?? "en attente d'un prérequis"}`;
  }
  if (w.upcoming.length > 0) return `À venir : ${w.upcoming[0].labelFr}`;
  return "Aucune action en attente sur ce dossier.";
}

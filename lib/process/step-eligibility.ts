/**
 * THE one answer to "may this person act on this step, right now?" — PURE.
 * ---------------------------------------------------------------------------
 * Two surfaces execute official steps today — the department queue
 * (`/queues/[queueKey]`) and the dossier's official-process page
 * (`/files/[id]/process`) — and a third is being added on the dossier itself.
 * They all call the SAME server actions, so they must offer the same buttons on
 * the same facts.
 *
 * WHY THIS FILE GREW (OPS-CUSTOMS-GAINDE-04, slice 5). The evaluator was pure
 * and shared, and the two surfaces still disagreed three provable ways — because
 * it decided nothing it was not handed, and each caller assembled the facts
 * itself:
 *
 *   1. EVIDENCE. The queue folded missing evidence into `blockedReason`; the
 *      process page folded in only missing prerequisites. So the dossier surface
 *      offered « Terminer » on steps `submitStep` then refused with
 *      `evidence_missing`.
 *   2. CUSTODY. `awaitingReception` was a boolean derived from SENT handoffs
 *      alone — a partial re-implementation of `custodyStateFor`, which also
 *      knows `awaiting_transmission`. A step whose governed route had sent
 *      nothing looked ready and was refused `handoff_not_sent`.
 *   3. CLAIM. `claimedByAnother` fired only on ACTIVE, while the engine's
 *      `assignmentRefusal` bites in ANY state once an assignee exists — and
 *      Transit writes assignments on AVAILABLE rows. So « Démarrer » was offered
 *      on work the engine refuses with `step_assigned_to_other`.
 *
 * Adding a third surface on top of those facts would have inherited all three.
 * So the FACTS moved into the evaluator: it now takes the evidence items, the
 * custody state and the assignment, and derives the blocking itself. There is
 * one loader (`lib/process/contextual/facts.ts`) and every surface reads it.
 *
 * TWO MORE THINGS IT CAN NOW EXPRESS, both of which used to make a surface lie:
 *
 *   * UNAUTHORIZED EVIDENCE. `evaluateStepEvidence` reports items the viewer
 *     cannot see; `complete` deliberately ignores them (right for display) and
 *     `submitStep` hard-refuses on them (right for a write). A card that read
 *     `complete` said « prêt » to someone the server would refuse. It is now a
 *     state of its own with its own sentence.
 *   * GOVERNANCE CLASS (leniency doctrine, 2026-09-06). A requirement is
 *     HARD_GATE, SOFT_GATE, CONTROLLED_EXCEPTION or INFORMATIONAL, and only a
 *     hard one should stop work. Until Effitrans ratifies the classification
 *     matrix nothing is reclassified — see `requirement-class.ts` for why
 *     unilaterally softening a shipped gate would be its own unratified change
 *     — but the shape is here and the operator is told the truth about it.
 *
 * WHAT THIS IS, AND IS NOT. It decides what a surface OFFERS. It is not a
 * boundary: `activateStep` and `submitStep` re-check permission, ownership,
 * prerequisites, custody, evidence and state on every call, and they are what
 * actually refuse. A UI that hides a button is a courtesy; a server that refuses
 * is the control. The rule for changing this file is therefore narrow — it may
 * become no more permissive than the engine, and where it is stricter (see CLAIM
 * below) that strictness must be a deliberate, recorded product decision.
 */
import { stepPermission, validatorStepFor } from "./engine/state";
import { domainOwnedReasonFr, isGenericTransitionWithdrawn } from "./domain-owned-steps";
// The PURE check module, not the server-side permissions facade: this file
// is read by client components and must not drag a React cache() into them.
import { hasPermission } from "@/lib/rbac/check";
import {
  ASSIGNMENT_OWNED_STEPS,
  custodyRefusalForState,
  type CustodyRefusal,
  type CustodyState,
} from "./handoff-routes";
import { evaluateControlOwnership } from "./control-ownership";
import {
  blocksCompletion,
  governanceFor,
  requirementMessageFr,
  NOT_APPLICABLE_GOVERNANCE,
  type RequirementClass,
} from "./requirement-class";
import type { ServiceKey } from "./service-scope";

/** One requirement of a step that is not satisfied yet. */
export type StepRequirementFact = {
  /** Official evidence key from the registry (e.g. BON_A_ENLEVER). */
  key: string;
  labelFr: string;
  /** Exactly the evaluator's own vocabulary — never a rendered flag. */
  status: "missing" | "invalid" | "pending_review" | "unauthorized";
};

/** Everything the decision needs. Each field is a FACT, never a rendered flag. */
export type StepActionFacts = {
  stepKey: string;
  /** process_step_execution.state */
  state: string;
  /** process_step_execution.assigned_user_id */
  assignedUserId: string | null;
  /**
   * process_step_execution.submitted_by — WHO submitted this step for review.
   *
   * STEP18-COMPLETENESS-02. The maker of a maker/checker pair. It is the one
   * fact that decides whether a surface may offer the REVIEW, and it is never
   * inferred: a caller that does not supply it gets no review button, because
   * independence that cannot be demonstrated must not be claimed. The engine
   * re-checks it regardless — `evaluateMakerChecker` compares identities on
   * every `approveStep`, so a missing fact here costs a button, never a
   * control.
   */
  submittedBy?: string | null;
  /**
   * Where the step stands in its custody transfer — the FULL state, not a
   * boolean. `awaiting_reception` and `awaiting_transmission` are different
   * refusals (`handoff_reception_required` vs `handoff_not_sent`) and need
   * different sentences because they need different acts.
   */
  custody: CustodyState;
  /** `process_step_owning_role.role_code`, or null when the step has no owner. */
  owningRole: string | null;
  /** Step keys this step depends on that are not terminal yet. */
  missingPrerequisites: readonly string[];
  /** Unsatisfied requirements, from `evaluateStepEvidence`. */
  requirements: readonly StepRequirementFact[];
  /**
   * A blocker that is neither evidence nor a prerequisite — an open process
   * blocker, say. Already resolved to French by the caller.
   */
  blockedReason?: string | null;
  /**
   * Set when this step belongs to a service Effitrans is NOT providing on this
   * dossier (OPS-SERVICE-SCOPE-01). It is the FIRST question asked, before
   * evidence and before timing: a requirement of a service nobody bought is
   * not missing, not pending and not blocked — it is out of scope.
   *
   * Null on every dossier whose scope is UNKNOWN, which is every production
   * dossier today, so this changes nothing until a scope is actually recorded.
   */
  notApplicable?: { service: ServiceKey; reasonFr: string } | null;
};

export type StepActionViewer = {
  userId: string;
  permissions: readonly string[];
  /** Tenant role codes. Ownership is a ROLE question, not a permission one. */
  roles: readonly string[];
};

/** A requirement as a surface should render it. */
export type StepRequirementView = StepRequirementFact & {
  klass: RequirementClass;
  /** Has Effitrans ruled on the class? */
  ratified: boolean;
  /** Does it stop this step from completing right now? */
  blocking: boolean;
  messageFr: string;
};

export type StepEligibility = {
  /** The step's own permission — `permissions[0]`, exactly as the engine reads it. */
  permission: string;
  /** Does the viewer hold it? The engine's `guard()` asks precisely this. */
  mayAct: boolean;
  /**
   * Is this work the viewer's? By owning role, or by an explicit assignment.
   * Drives whether a step is DRAWN at all — a step that will never be this
   * person's is noise, not information.
   */
  isOwner: boolean;
  /** Claimed by somebody else — see the CLAIM note in `evaluateStepAction`. */
  claimedByAnother: boolean;
  custody: CustodyState;
  /**
   * WHY custody stops this step, or null when it does not — the engine's own
   * verdict, from `custodyRefusalForState`. Read it rather than re-deriving
   * from `custody`: three of the four routes set `requiresReception: false`,
   * and `awaiting_transmission` on those does NOT block (UAT-STEP10-HANDOFF-01).
   */
  custodyRefusal: CustodyRefusal | null;
  /** Kept for callers that only ask the old question. */
  awaitingReception: boolean;
  /** Out of scope for this dossier. Never « missing », never blocking. */
  notApplicable: { service: ServiceKey; reasonFr: string } | null;
  /** The viewer cannot see the evidence this step requires. Never « prêt ». */
  unauthorized: boolean;
  /** Every unsatisfied requirement, classified. */
  requirements: StepRequirementView[];
  /** AVAILABLE → ACTIVE. Claims the step for the viewer. */
  canStart: boolean;
  /** ACTIVE → SUBMITTED/COMPLETED. */
  canSubmit: boolean;
  /**
   * The VALIDATION step that reviews this one, when this step is half of a
   * ratified maker/checker pair. Null for ordinary steps.
   *
   * Surfaces address `approveStep`/`rejectStep` by this key, never by the row's
   * own — see `validatorStepFor`.
   */
  reviewStepKey: string | null;
  /** The permission the VALIDATOR step requires, exactly as `approveStep` resolves it. */
  reviewPermission: string | null;
  /** True when the viewer submitted this step — the maker may never review it. */
  isSubmitter: boolean;
  /**
   * SUBMITTED → COMPLETED, by an INDEPENDENT checker (STEP18-COMPLETENESS-02).
   *
   * Exposure only. The engine still enforces the permission, the SUBMITTED
   * state and — on identity — maker ≠ checker, so this can hide a button the
   * server would have accepted but can never reveal one it would refuse.
   */
  canApprove: boolean;
  /** SUBMITTED → REJECTED, same authority as the approval. A reason is mandatory. */
  canReject: boolean;
  /**
   * Why nothing is offered, in the operator's language. Never null when both
   * actions are unavailable and the step is otherwise open — an empty row that
   * explains itself beats a silent one.
   */
  reasonFr: string | null;
};

/** States in which a surface may reasonably talk about executing a step. */
const OFFERABLE = new Set(["AVAILABLE", "ACTIVE"]);

export function evaluateStepAction(
  facts: StepActionFacts,
  viewer: StepActionViewer,
): StepEligibility {
  const permission = stepPermission(facts.stepKey);
  const mayAct = hasPermission([...viewer.permissions], permission);
  // APPLICABILITY FIRST — before evidence, before timing, before leniency.
  // Asking « is this document present » ahead of « did we sell this service »
  // is how a transport-only dossier ends up waiting for a customs declaration
  // nobody agreed to file.
  const notApplicable = facts.notApplicable ?? null;

  // OWNERSHIP. The same pure rule the customs controls use and `activateStep`
  // now enforces, so a card and a button cannot disagree about whose work this
  // is. `assigned_to_other` is not ownership — that case is the claim below.
  const own = evaluateControlOwnership({
    hasInstance: true,
    owningRole: facts.owningRole,
    actorRoles: viewer.roles,
    stepAssignedUserId: facts.assignedUserId,
    userId: viewer.userId,
  });
  const isOwner = own.allowed && own.reason !== "assigned_to_other";

  // CLAIM. `activateStep` writes `assigned_user_id = caller`, so an ACTIVE step
  // belongs to whoever started it. For the steps Transit ASSIGNS, the engine's
  // `assignmentRefusal` bites in any state once an assignee exists — including
  // AVAILABLE, which Transit genuinely writes. Restricting this to ACTIVE
  // offered « Démarrer » on work the engine refuses; the two now agree.
  //
  // Elsewhere the ACTIVE-only rule stays a deliberate UI narrowing, ratified
  // 2026-09-04: an official step is somebody's work, and a supervisor must not
  // complete an Account Manager's attestation for them by pressing a button on
  // a page they can both see. Recorded as a narrowing rather than as a guard,
  // because it is not one.
  const claimedByAnother =
    facts.assignedUserId !== null &&
    facts.assignedUserId !== viewer.userId &&
    (facts.state === "ACTIVE" || ASSIGNMENT_OWNED_STEPS.has(facts.stepKey));

  // CUSTODY — asked of the ENGINE'S rule, not of a copy of it.
  //
  // UAT-STEP10-HANDOFF-01. This used to read « awaiting_reception OR
  // awaiting_transmission », which is the rule for a route that REQUIRES
  // reception. Three of the four routes deliberately do not, so on those this
  // refused work `activateStep` would have accepted — the UI stricter than the
  // server, which the contract at the top of this file forbids. Step 10 of
  // EFT-IMP-2026-00011 was unstartable for the Coordinator because of it.
  const custodyRefusalCode = custodyRefusalForState(facts.stepKey, facts.custody);
  const custodyBlocked = custodyRefusalCode !== null;

  // EVIDENCE. Derived HERE, from the items, rather than trusted from a caller's
  // pre-rendered sentence — which is how two surfaces came to hold two opinions.
  const unauthorized = facts.requirements.some((r) => r.status === "unauthorized");
  const requirements: StepRequirementView[] = facts.requirements.map((r) => {
    // Out of scope ⇒ out of scope for its requirements too. They are reported,
    // never as « manquant ».
    const governance = notApplicable
      ? NOT_APPLICABLE_GOVERNANCE
      : governanceFor(facts.stepKey, r.key);
    // AUTHORITY IS NEVER SOFTENED BY A CLASSIFICATION. `unauthorized` means the
    // viewer cannot see the evidence, so they may not close it either —
    // `submitStep` refuses it on its own terms. Everything else answers from
    // the ratified class, and an unruled requirement does NOT block.
    const blocking =
      r.status === "unauthorized" ? !notApplicable : blocksCompletion(governance);
    return {
      ...r,
      klass: governance.klass,
      ratified: governance.ratified,
      blocking,
      messageFr: requirementMessageFr({ labelFr: r.labelFr, governance, blocks: blocking }),
    };
  });
  const evidenceBlocked = requirements.some((r) => r.blocking);

  const prerequisitesUnmet = facts.missingPrerequisites.length > 0;
  const otherBlocker = Boolean(facts.blockedReason);
  const blockedForStart =
    prerequisitesUnmet || otherBlocker || facts.state === "BLOCKED" || Boolean(notApplicable);
  const blockedForSubmit = blockedForStart || evidenceBlocked || (unauthorized && !notApplicable);

  // BILLING-BYPASS-01 — a transition a DOMAIN workflow owns is not offered here.
  //
  // `billing_draft` declares no required documents, so nothing above could
  // refuse it and the generic « Terminer » closed step 20 with no invoice at
  // all. Withdrawing the control is the courtesy; `submitStep` refuses it too,
  // because this evaluator is read by a client and the engine action is a
  // `"use server"` endpoint. Starting the step is untouched — claiming the work
  // is not the act that needs the domain's rules.
  const submitWithdrawn = isGenericTransitionWithdrawn(facts.stepKey, "submit");

  const canStart =
    mayAct && isOwner && facts.state === "AVAILABLE" && !claimedByAnother
    && !custodyBlocked && !blockedForStart;
  const canSubmit =
    mayAct && facts.state === "ACTIVE" && !claimedByAnother
    && !custodyBlocked && !blockedForSubmit && !submitWithdrawn;

  // ---------------------------------------------------------------- REVIEW --
  //
  // STEP18-COMPLETENESS-02. The checker's half of a ratified maker/checker
  // pair, which no surface could reach: `StepActions` offered only Démarrer and
  // Terminer, and neither the coordination nor the account-management queue
  // declared an `approve` action. A SUBMITTED `coordinator_completeness` was
  // therefore terminal in the UI — steps 18, 19 and 20 unreachable on every
  // dossier, with the engine perfectly willing the whole time.
  //
  // FOUR CONDITIONS, and each is the engine's own:
  //
  //   1. A RATIFIED PAIR. `validatorStepFor` reads MAKER_CHECKER_PAIRS, so a
  //      step nobody declared reviewable offers nothing. No step key appears
  //      here; the registry decides.
  //   2. SUBMITTED. `approveStep` refuses any other state (`invalid_state`),
  //      and only `submitStep` produces it.
  //   3. THE VALIDATOR'S PERMISSION — not this row's. `approveStep` guards on
  //      `getNode(validatorStepKey).permissions[0]`, and for two of the three
  //      pairs that differs from the preparer's. Asking the preparer's
  //      permission would have offered the Déclarant the Chef's validation.
  //   4. MAKER ≠ CHECKER, on IDENTITY. Unknown maker ⇒ no offer: see
  //      `submittedBy`. This is a courtesy that mirrors the control; the
  //      control itself is `evaluateMakerChecker`, which refuses regardless
  //      and cannot be reached around.
  //
  // Deliberately NOT conditioned on `isOwner` or `claimedByAnother`. Reviewing
  // is by definition somebody else's work: the reviewer is not the assignee,
  // and the row is claimed by the maker precisely because they submitted it.
  // Ownership here is expressed by holding the VALIDATOR's permission.
  const reviewStepKey = validatorStepFor(facts.stepKey);
  const reviewPermission = reviewStepKey === null ? null : stepPermission(reviewStepKey);
  const isSubmitter =
    typeof facts.submittedBy === "string"
    && facts.submittedBy.length > 0
    && facts.submittedBy === viewer.userId;
  const mayReview =
    reviewPermission !== null && hasPermission([...viewer.permissions], reviewPermission);
  // BILLING-BYPASS-01 — and the REVIEW half, keyed on the VALIDATOR step.
  //
  // STEP18-COMPLETENESS-02 added Valider/Rejeter for EVERY ratified pair, which
  // is right for `completeness_review` — the generic controls ARE the act there
  // — and wrong for `invoice_validation`, where they are a way around one.
  // `approveStep` inspects no invoice, so the generic approval completed steps
  // 20 and 21 on a draft nobody had validated.
  const reviewWithdrawn =
    reviewStepKey !== null
    && (isGenericTransitionWithdrawn(reviewStepKey, "approve")
      || isGenericTransitionWithdrawn(reviewStepKey, "reject"));

  const canApprove =
    reviewStepKey !== null
    && facts.state === "SUBMITTED"
    && mayReview
    && !isSubmitter
    // An unknown maker cannot be shown to differ from the viewer.
    && typeof facts.submittedBy === "string"
    && facts.submittedBy.length > 0
    && !custodyBlocked
    && !notApplicable
    && !reviewWithdrawn;
  // The same authority decides both verdicts — `rejectStep` guards identically
  // and additionally demands a reason, which the surface collects.
  const canReject = canApprove;

  return {
    permission,
    mayAct,
    isOwner,
    claimedByAnother,
    custody: facts.custody,
    custodyRefusal: custodyRefusalCode,
    awaitingReception: facts.custody === "awaiting_reception",
    notApplicable,
    unauthorized,
    requirements,
    canStart,
    canSubmit,
    reviewStepKey,
    reviewPermission,
    isSubmitter,
    canApprove,
    canReject,
    reasonFr: reasonFor({
      facts,
      notApplicable,
      mayAct,
      isOwner,
      claimedByAnother,
      custodyRefusalCode,
      unauthorized,
      requirements,
      prerequisitesUnmet,
      canStart,
      canSubmit,
      reviewStepKey,
      isSubmitter,
      mayReview,
      submitWithdrawn,
      reviewWithdrawn,
    }),
  };
}

function reasonFor(input: {
  facts: StepActionFacts;
  notApplicable: { service: ServiceKey; reasonFr: string } | null;
  mayAct: boolean;
  isOwner: boolean;
  claimedByAnother: boolean;
  custodyRefusalCode: CustodyRefusal | null;
  unauthorized: boolean;
  requirements: StepRequirementView[];
  prerequisitesUnmet: boolean;
  canStart: boolean;
  canSubmit: boolean;
  reviewStepKey: string | null;
  isSubmitter: boolean;
  mayReview: boolean;
  submitWithdrawn: boolean;
  reviewWithdrawn: boolean;
}): string | null {
  const {
    facts, notApplicable, mayAct, isOwner, claimedByAnother, custodyRefusalCode, unauthorized,
    requirements, prerequisitesUnmet, canStart, canSubmit, reviewStepKey, isSubmitter, mayReview,
    submitWithdrawn, reviewWithdrawn,
  } = input;
  if (canStart || canSubmit) return null;

  // BILLING-BYPASS-01 — a withdrawn control must never read as a broken one.
  // Said before every other explanation, because the act is not blocked at all:
  // it simply has its own door, and the operator needs to be sent there.
  if (submitWithdrawn && facts.state === "ACTIVE") {
    return domainOwnedReasonFr(facts.stepKey);
  }
  if (reviewWithdrawn && facts.state === "SUBMITTED" && reviewStepKey !== null) {
    return domainOwnedReasonFr(reviewStepKey);
  }
  // Out of scope outranks every other explanation: telling somebody which
  // document is missing from work Effitrans is not doing would be noise.
  if (notApplicable) return notApplicable.reasonFr;

  // A step awaiting its independent checker. Previously this returned null —
  // SUBMITTED is not OFFERABLE — so the maker saw a row with no button and no
  // sentence and could not tell « done » from « broken ». Three audiences,
  // three different facts, none of which invites an act the engine refuses.
  if (facts.state === "SUBMITTED" && reviewStepKey !== null) {
    if (isSubmitter) {
      return "Étape soumise. La validation revient à une autre personne habilitée — vous ne pouvez pas valider votre propre contrôle.";
    }
    if (!mayReview) return "En attente de validation indépendante.";
    return null; // the checker: the buttons speak for themselves
  }

  if (!OFFERABLE.has(facts.state)) return null; // nothing to explain yet
  // Order is what an operator can act on first. Both sentences are spoken from
  // the REFUSAL, never from the raw state: an `awaiting_transmission` that does
  // not block has nothing to say, and saying it anyway is what put « Bloquée »
  // on a step the server would have run.
  if (custodyRefusalCode === "handoff_reception_required") {
    return "Le transfert doit d'abord être réceptionné.";
  }
  if (custodyRefusalCode === "handoff_not_sent") {
    return "Le dossier doit d'abord être formellement transmis au service suivant.";
  }
  if (prerequisitesUnmet || facts.blockedReason) {
    return facts.blockedReason ?? "Un point bloquant est ouvert sur ce dossier.";
  }
  if (!mayAct) return "Cette étape relève d'un autre rôle.";
  if (claimedByAnother) return "Étape déjà prise en charge par une autre personne.";
  if (!isOwner) return "Cette étape relève du rôle responsable de cette étape.";
  // A viewer who cannot see the evidence must never read « prêt ».
  if (unauthorized) return "Informations insuffisantes pour évaluer cette étape.";
  const blocking = requirements.filter((r) => r.blocking);
  if (blocking.length > 0) return blocking[0].messageFr;
  return null;
}

/**
 * Step-satisfaction model (Phase WES-5B). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * For each official step that an AUTHORITATIVE MODULE FACT can prove, one pure
 * function answers: given the facts, what state should this step be in?
 *
 * The doctrine this encodes:
 *
 *     Module facts → evidence evaluation → deterministic reconciliation
 *     → process-step state → canonical projection → tasks and handoffs
 *
 * ---------------------------------------------------------------------------
 * WHICH STEPS ARE FACT-PROVABLE, AND WHICH ARE NOT
 *
 * The audit sorted the 26-step registry into two classes, and the boundary is
 * the whole design:
 *
 *   FACT-PROVABLE   the step's business meaning IS a module fact. "Customs
 *                   released" is `customs_record.status = RELEASED`; there is
 *                   nothing else it could mean. Reconciliation may complete
 *                   these, because the fact was already recorded atomically
 *                   with its own WES-9 event by an authorized actor.
 *
 *   HUMAN-ONLY      the step's meaning is a human decision — a maker-checker
 *                   review, a validation, a reception. `transit_validation`
 *                   is not provable by any table row: its entire point is that
 *                   a person looked. Reconciliation must NEVER complete these;
 *                   the engine's submit/approve flow with identity-separated
 *                   maker-checker remains the only path.
 *
 * A step absent from FACT_RULES is human-only BY DEFAULT. Fail-closed: the
 * model can under-automate, never over-automate.
 *
 * ---------------------------------------------------------------------------
 * CONFLICTS ARE RETURNED, NEVER RESOLVED
 *
 * When persisted process state contradicts the facts (a step COMPLETED while
 * its fact is absent), this model reports CONFLICT. It does not pick a winner:
 * silently regressing the step would erase a human's recorded decision, and
 * silently trusting it would let workflow state manufacture facts. A person
 * with authority resolves conflicts; the model's job is to make them visible.
 */

import { CUSTOMS_RANK, TRANSPORT_RANK } from "@/lib/files/lifecycle";
import { stepAppliesToFileType } from "@/lib/process/applicability";

/** The six verdicts of WES-5B. */
export type StepSatisfaction =
  | "NOT_APPLICABLE"
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SATISFIED"
  | "BLOCKED"
  | "CONFLICT";

/** Authoritative module facts for one dossier, read by the service layer. */
export type ModuleFacts = {
  fileType: string;
  /** operational_file.status */
  fileStatus: string;
  /** customs_record, when one exists. */
  customs: {
    status: string;
    required: boolean;
    declarationNumber: string | null;
    baeReference: string | null;
    /** MAYA-P1.1 milestone: when Finance recorded the GAINDE registration. */
    gaindeRegisteredAt: string | null;
  } | null;
  /** transport_record, when one exists. */
  transport: { status: string } | null;
  /** Current (non-superseded) verified POD document id, if any. */
  verifiedPodDocumentId: string | null;
  /** Current verified BAE document id, if any (WES-4 evidence, not the reference). */
  verifiedBaeDocumentId: string | null;
};

export type StepEvaluation = {
  stepKey: string;
  satisfaction: StepSatisfaction;
  /** The fact that proves (or fails to prove) it — for explainability. */
  factFr: string;
  /**
   * When SATISFIED and a specific document version is the proof, its id — so
   * consumption records the EXACT version (WES-5D).
   */
  evidenceDocumentId: string | null;
};

type FactRule = {
  /** SATISFIED when this returns true. */
  satisfied: (f: ModuleFacts) => boolean;
  /** IN_PROGRESS (work observably started) when this returns true. */
  started: (f: ModuleFacts) => boolean;
  /** The document version that constitutes the proof, when one does. */
  evidence?: (f: ModuleFacts) => string | null;
  factFr: string;
};

const customsRank = (f: ModuleFacts): number =>
  f.customs ? (CUSTOMS_RANK[f.customs.status] ?? 0) : 0;
const transportRank = (f: ModuleFacts): number =>
  f.transport ? (TRANSPORT_RANK[f.transport.status] ?? 0) : 0;

/**
 * The fact-provable steps. Deliberately SHORT: every entry must survive the
 * question "could this step mean anything other than this fact?" — if the
 * answer is yes, it stays human-only.
 *
 * Notably ABSENT, and why:
 *   * transit_validation, finance_invoice_validation, coordinator_* — reviews
 *     and receptions; a person's judgement is the deliverable.
 *   * billing_*, courier_deposit, collections — already engine-integrated by
 *     their own module actions (Phase 5.0D); adding a second completion path
 *     here would create the dual authority WES-5 exists to remove.
 *   * transport_assignment — a driver NAME on the row is not an assignment
 *     decision; WES-3's atomic path records assignments, and the step includes
 *     vehicle/route work no fact captures.
 */
export const FACT_RULES: Readonly<Record<string, FactRule>> = {
  // The dossier exists and left DRAFT. The opening step cannot still be open
  // for a dossier that is demonstrably in progress.
  am_dossier_opening: {
    satisfied: (f) => f.fileStatus !== "DRAFT" && f.fileStatus !== "CANCELLED",
    started: (f) => f.fileStatus === "DRAFT",
    factFr: "Dossier ouvert (statut du dossier au-delà de Brouillon)",
  },

  // GAINDE registration: the FINANCE milestone — not the Declarant's paperwork.
  //
  // MAYA-P1.2. This rule used to read « DECLARED-or-later + a declaration
  // number ». That is the DECLARANT's fact, written under customs:update, and
  // it was completing a step the registry assigns to CUSTOMS_FINANCE_OFFICER
  // whose requiredEvidence it spells out as registration_date + registered_by.
  // The proxy was reasonable when no milestone existed; WES-5 shipped before
  // P1.1 created one. It is not reasonable now, and it was not harmless: a
  // production dossier was already COMPLETED at this step, provenance
  // RECONCILED, fact CUSTOMS_DECLARED, on a registration Finance never made.
  //
  // Tightening a rule regresses nothing — that is the point of the CONFLICT
  // verdict below. A step completed on the old proxy whose milestone is absent
  // now reports CONFLICT: reported, never resolved, which is the truth about it.
  gainde_registration: {
    satisfied: (f) => Boolean(f.customs?.gaindeRegisteredAt),
    // Deliberately keyed on the milestone ALONE. `external_ref` stays writable
    // through customs:update, so keying on the reference would let an unrelated
    // edit reopen an act Finance already performed and signed.
    //
    // `started` is unchanged: a declaration under way is the registration
    // visibly pending. IN_PROGRESS completes nothing.
    started: (f) => customsRank(f) > 0,
    factFr: "Enregistrement GAINDE effectué par la Finance (date + agent)",
  },

  // Field clearance culminates in the official release. RELEASED is the fact;
  // the WES-4 split guarantees it was recorded deliberately, with a BAE
  // reference, by a holder of customs:release.
  customs_field_clearance: {
    satisfied: (f) => f.customs?.status === "RELEASED",
    started: (f) => customsRank(f) >= (CUSTOMS_RANK["DECLARED"] ?? 99),
    factFr: "Mainlevée douanière constatée (statut RELEASED)",
  },

  // Pickup happened. PICKED_UP or any later transport state proves it — the
  // ladder is monotonic, so IN_TRANSIT implies the pickup occurred.
  pickup: {
    satisfied: (f) => transportRank(f) >= (TRANSPORT_RANK["PICKED_UP"] ?? 99),
    started: (f) => transportRank(f) >= (TRANSPORT_RANK["PLANNED"] ?? 99),
    factFr: "Enlèvement effectué (statut transport PICKED_UP ou au-delà)",
  },

  // The POD is in hand: either the transport row says so, or a VERIFIED POD
  // document exists. When the document is the proof, its exact version is
  // consumed (WES-5D).
  transport_pod_handoff: {
    satisfied: (f) =>
      transportRank(f) >= (TRANSPORT_RANK["POD_RECEIVED"] ?? 99) ||
      Boolean(f.verifiedPodDocumentId),
    started: (f) => transportRank(f) >= (TRANSPORT_RANK["DELIVERED"] ?? 99),
    evidence: (f) => f.verifiedPodDocumentId,
    factFr: "Preuve de livraison reçue (POD vérifié ou statut POD_RECEIVED)",
  },
};

export const FACT_PROVABLE_STEP_KEYS: readonly string[] = Object.keys(FACT_RULES);

/** Persisted execution state, as the service reads it. */
export type ExecutionState = {
  stepKey: string;
  state: string;
} | null;

/**
 * Evaluate ONE step against the facts and its persisted execution.
 *
 * Pure and total: every combination of inputs yields exactly one verdict, so
 * the reconciliation service is deterministic and the tests enumerate reality.
 */
export function evaluateStep(input: {
  stepKey: string;
  facts: ModuleFacts;
  execution: ExecutionState;
}): StepEvaluation {
  const { stepKey, facts, execution } = input;
  const rule = FACT_RULES[stepKey];

  const base = { stepKey, evidenceDocumentId: null as string | null };

  // Applicability comes from the registry the engine already obeys.
  if (!stepAppliesToFileType(stepKey, facts.fileType)) {
    return { ...base, satisfaction: "NOT_APPLICABLE", factFr: "Étape non applicable à ce type de dossier" };
  }
  // A customs step on a dossier whose customs leg is explicitly not required.
  if (
    (stepKey === "gainde_registration" || stepKey === "customs_field_clearance") &&
    facts.customs !== null &&
    facts.customs.required === false
  ) {
    return { ...base, satisfaction: "NOT_APPLICABLE", factFr: "Douane non requise pour ce dossier" };
  }

  // Human-only step: this model has no opinion beyond what is persisted.
  if (!rule) {
    const state = execution?.state ?? null;
    if (state === "COMPLETED" || state === "SKIPPED") {
      return { ...base, satisfaction: "SATISFIED", factFr: "Étape réalisée par décision humaine (moteur officiel)" };
    }
    if (state === "ACTIVE" || state === "SUBMITTED" || state === "AVAILABLE") {
      return { ...base, satisfaction: "IN_PROGRESS", factFr: "Étape en cours dans le moteur officiel" };
    }
    if (state === "BLOCKED") {
      return { ...base, satisfaction: "BLOCKED", factFr: "Étape bloquée dans le moteur officiel" };
    }
    return { ...base, satisfaction: "NOT_STARTED", factFr: "Étape à réaliser par une personne" };
  }

  const factSatisfied = rule.satisfied(facts);
  const persisted = execution?.state ?? null;

  // CONFLICT: the engine says done, the facts say otherwise. Never resolved
  // here — a human recorded that completion, and a fact contradicts it.
  if ((persisted === "COMPLETED" || persisted === "APPROVED") && !factSatisfied) {
    return {
      ...base,
      satisfaction: "CONFLICT",
      factFr: `Étape marquée terminée mais le fait attendu est absent — ${rule.factFr}`,
    };
  }

  // SUBMITTED means a maker-checker review is pending. The fact may already be
  // true, but completing over a pending review would bypass the checker.
  if (persisted === "SUBMITTED") {
    return { ...base, satisfaction: "IN_PROGRESS", factFr: "En attente de validation (maker-checker)" };
  }

  if (factSatisfied) {
    return {
      ...base,
      satisfaction: "SATISFIED",
      evidenceDocumentId: rule.evidence?.(facts) ?? null,
      factFr: rule.factFr,
    };
  }
  if (persisted === "BLOCKED") {
    return { ...base, satisfaction: "BLOCKED", factFr: rule.factFr };
  }
  if (rule.started(facts) || persisted === "ACTIVE" || persisted === "AVAILABLE") {
    return { ...base, satisfaction: "IN_PROGRESS", factFr: rule.factFr };
  }
  return { ...base, satisfaction: "NOT_STARTED", factFr: rule.factFr };
}

/**
 * May reconciliation COMPLETE this persisted state? The allowed set is
 * deliberately narrow and mirrored by a CHECK in the RPC:
 *   * PENDING / AVAILABLE / ACTIVE / BLOCKED  → yes (forward, no review pending)
 *   * COMPLETED / SKIPPED                     → no-op (idempotent)
 *   * SUBMITTED                               → never (a review is pending)
 *   * APPROVED / REJECTED / CANCELLED         → never (a decision exists)
 */
export function mayReconcileComplete(persistedState: string | null): boolean {
  return (
    persistedState === null ||
    persistedState === "PENDING" ||
    persistedState === "AVAILABLE" ||
    persistedState === "ACTIVE" ||
    persistedState === "BLOCKED"
  );
}

/**
 * Governance class of a requirement — the leniency doctrine, made operative.
 * PURE and client-safe.
 * ---------------------------------------------------------------------------
 * RATIFIED 2026-09-06, EXTENDED AND MADE OPERATIVE 2026-09-07 (OPS-LENIENCY-01).
 * Effitrans must not block operations merely because something is missing.
 * Governance without unnecessary friction. Every requirement is classified by
 * WHEN and WHY it is required, not merely by whether it is present:
 *
 *   HARD_GATE            the process cannot legitimately continue past this
 *                        control point — a legal or customs prerequisite,
 *                        maker/checker, mandatory role validation, a payment
 *                        control, BAE/release, security or ownership authority.
 *   SOFT_GATE            it should exist, and legitimate work continues while
 *                        it is obtained. Warn, name WHERE it becomes mandatory,
 *                        keep it visible.
 *   CONTROLLED_EXCEPTION normally required here, but an authorized person may
 *                        continue with a motif, an actor, a timestamp and an
 *                        audit trail — never over maker/checker, authority,
 *                        tenant security, Chef validation, Finance payment
 *                        authority or BAE/release.
 *   INFORMATIONAL        never blocks; feeds completeness and quality.
 *   NOT_APPLICABLE       the service was not contracted, or the condition is
 *                        absent. Never blocks, and is never « missing ».
 *   FLAG_FOR_RULING      no first-party Effitrans source establishes which of
 *                        the above it is.
 *
 * ── WHAT CHANGED ON 2026-09-07, AND WHY IT IS A REVERSAL ────────────────────
 * The 2026-09-06 slice classified but deliberately did NOT change behaviour:
 * an unruled requirement kept blocking, on the reasoning that switching off a
 * shipped gate is itself an unratified act. Effitrans has now ruled the other
 * way, and explicitly:
 *
 *     « UNKNOWN BUSINESS COMPLETENESS REQUIREMENT MUST NOT AUTOMATICALLY
 *       BECOME HARD_GATE. »
 *
 * So `blocksCompletion` now answers from the CLASS, and FLAG_FOR_RULING does
 * not block. That is a real loosening of live behaviour, and three things keep
 * it safe rather than reckless:
 *
 *   1. CLASSIFYING SOMETHING HARD PRESERVES TODAY'S BEHAVIOUR; classifying it
 *      SOFT changes it. So the burden of citation sits where the risk is: every
 *      SOFT entry below names the LATER checkpoint that still enforces the
 *      artefact, and where no such checkpoint exists the entry stays HARD.
 *   2. ONLY STEP EVIDENCE IS AFFECTED. Prerequisites, custody, the owning-role
 *      gate, permissions, the state machine, maker/checker review, RLS, the
 *      SECURITY DEFINER authority assertions and every database CHECK are
 *      untouched. Authority is never softened by a classification.
 *   3. NOTHING IS FORGOTTEN. A step completed with an outstanding SOFT item
 *      still records it — `submitStep` writes `evidence_summary.missing` — so
 *      leniency leaves a trail rather than a hole.
 *
 * ── THE ONE PLACE THIS IS READ FROM ─────────────────────────────────────────
 * `blockingRequirements()` is consumed by BOTH `evaluateStepAction` (what a
 * surface offers) and `submitStep` (what the server accepts). They must not
 * hold two opinions: a button offered against an engine that refuses is the
 * defect this whole programme exists to end.
 *
 * Populating CLASSIFIED is a governance act, not a coding one: each entry needs
 * a first-party citation in `source`, and « the code already does it » is not a
 * source — that reasoning is what produced 108 unexamined blockers.
 */
import type { EvidenceItem, StepEvidence } from "./engine/evidence";

export type RequirementClass =
  | "HARD_GATE"
  | "SOFT_GATE"
  | "CONTROLLED_EXCEPTION"
  | "INFORMATIONAL"
  | "NOT_APPLICABLE"
  | "FLAG_FOR_RULING";

export type RequirementGovernance = {
  /** The ratified class, or FLAG_FOR_RULING while the evidence is inconclusive. */
  klass: RequirementClass;
  /** Has Effitrans actually ruled on this one? */
  ratified: boolean;
  /**
   * Where an unresolved item becomes mandatory — an operator-facing phrase such
   * as « avant l'enlèvement (étape 15) ». Null when nothing establishes it.
   */
  mandatoryAtFr: string | null;
  /** The first-party source of the ruling. Empty only while unratified. */
  source: string;
};

// ---------------------------------------------------------------- sources ----

const K3 =
  "OPS-OWNERSHIP-01 K3 (ratifié 2026-09-05) — la désignation du Responsable client est le but même de l'étape ; assign_commercial_owner (migration 115) en est le seul écrivain.";
const MAKER_CHECKER =
  "Registre MAKER_CHECKER_PAIRS — paire customs_validation (préparateur étape 6, valideur étape 7). Une paire maker/checker sans artefact n'est pas un contrôle ; la doctrine de souplesse exclut explicitement le maker/checker de toute dérogation.";
const BAE =
  "Mainlevée douane. La doctrine ratifiée exclut « BAE/release safety controls » de toute dérogation ; TRANSIT-CUSTODY-05 (migration 20260930000001) lie l'enregistrement de la mainlevée à l'étape 13 et à son revendiqueur.";
const RATTACHEMENT =
  "DEC-C40 (ratifié 2026-09-06) — l'étape 11 est le rattachement du Déclarant ET sa vérification ; migration 20260828000001 y porte le fait. Les étapes 12 et 13 (suivi douanier, BAE) reposent sur cette preuve.";
const PICKUP_GATE =
  "Registre PICKUP_READINESS (Phase 5.0A) — la porte de convergence de l'enlèvement (étape 15) exige cet artefact. C'est la source de première main qui établit QUAND il devient obligatoire.";
const OBJECT_OF_THE_ACT =
  "L'artefact EST l'objet de l'acte : l'étape consiste à le remettre ou à le transmettre. Sans lui l'étape n'a pas de contenu, et la chaîne 15→26 étant strictement séquentielle, la laisser passer viderait les étapes suivantes.";
const COTATION =
  "QO-0/QO-1 (ratifié 2026-08-18, docs/commercial/quotation-optional-audit.md) — un dossier PEUT exister sans devis, et le mécanisme ratifié pour cela est le SAUT de l'étape 1 (`skipStep`, motif enregistré, audité, réouvrable), PAS sa clôture à vide. Quand l'étape 1 est vivante, le devis et son acceptation SONT son contenu ; QT609/QT613 (migration 20260806000001) contraignent déjà l'enregistrement de la décision client.";

const AVANT_ENLEVEMENT = "avant l'enlèvement (étape 15 — porte de convergence)";

// ------------------------------------------------------------- registry ------

const hard = (source: string): RequirementGovernance => ({
  klass: "HARD_GATE",
  ratified: true,
  mandatoryAtFr: null,
  source,
});

const soft = (mandatoryAtFr: string, source: string): RequirementGovernance => ({
  klass: "SOFT_GATE",
  ratified: true,
  mandatoryAtFr,
  source,
});

/**
 * Ratified classifications, keyed `"<stepKey>::<requirementKey>"`.
 *
 * Covers the 19 step-evidence requirements the 26-step registry declares. What
 * is absent is absent on purpose: `coordinator_completeness::RECEIPT`,
 * `::PAYMENT_PROOF` and `cotation`'s pair have no first-party source that says
 * when they become mandatory, so they fall through to FLAG_FOR_RULING and, per
 * the ratified default, do not block.
 */
export const CLASSIFIED: Readonly<Record<string, RequirementGovernance>> = {
  // ---- Authority and ownership — fail-closed by doctrine ------------------
  "operations_intake::ACCOUNT_MANAGER_ASSIGNMENT": hard(K3),

  // ---- Maker/checker — excluded from every derogation --------------------
  "customs_preparation::CUSTOMS_DOSSIER": hard(MAKER_CHECKER),
  "transit_validation::CUSTOMS_DOSSIER": hard(MAKER_CHECKER),

  // ---- The customs chain -------------------------------------------------
  "gainde_document_submission::GAINDE_SUBMISSION_EVIDENCE": hard(RATTACHEMENT),
  "customs_field_clearance::BON_A_ENLEVER": hard(BAE),

  // ---- Artefacts that ARE the act ----------------------------------------
  //
  // ⚠ THE DEVIS BELONGS HERE, NOT AMONG THE SOFT GATES. QO-0/QO-1 ratifies
  // that a dossier may exist WITHOUT a devis — and the mechanism it ratifies
  // for that is SKIPPING step 1, with a recorded motif and an audited reopen.
  // Completing step 1 on nothing is a different act: it asserts « le devis est
  // validé par le client » about a devis that does not exist. Classifying these
  // SOFT would have turned a ruling about OPTIONALITY into a licence to close
  // the step empty.
  "cotation::QUOTATION": hard(COTATION),
  "cotation::QUOTATION_APPROVAL": hard(COTATION),

  "transport_pod_handoff::SIGNED_DELIVERY_NOTE": hard(OBJECT_OF_THE_ACT),
  "billing_dispatch::FINAL_INVOICE": hard(OBJECT_OF_THE_ACT),
  "administration_deposit_prep::FINAL_INVOICE": hard(OBJECT_OF_THE_ACT),
  "courier_deposit::PROOF_OF_DEPOSIT": hard(OBJECT_OF_THE_ACT),
  "administration_proof_handoff::PROOF_OF_DEPOSIT": hard(OBJECT_OF_THE_ACT),

  // ---- SOFT: obtained in parallel, enforced at a NAMED later checkpoint ---
  // This is the correction OPS-UAT-CONVERGENCE-01 §8 demands. The BAD and the
  // Pre-Gate are real prerequisites of the enlèvement and the pickup gate says
  // so; they are NOT reasons to stop an Account Manager from working today.
  "bon_a_delivrer::BON_A_DELIVRER": soft(AVANT_ENLEVEMENT, PICKUP_GATE),
  "pre_gate::PRE_GATE_AUTHORIZATION": soft(AVANT_ENLEVEMENT, PICKUP_GATE),
  "transport_docs_transmission::PRE_GATE_AUTHORIZATION": soft(AVANT_ENLEVEMENT, PICKUP_GATE),
  "transport_docs_transmission::BORDEREAU_LIVRAISON": soft(AVANT_ENLEVEMENT, PICKUP_GATE),

  // The POD is obtained during the delivery follow-up and formally handed over
  // at step 17, which is HARD above and is a strict prerequisite of billing.
  "am_delivery_followup::SIGNED_DELIVERY_NOTE": soft(
    "avant la remise des justificatifs au Coordinateur (étape 17)",
    OBJECT_OF_THE_ACT,
  ),

};

/** What we say about a requirement Effitrans has not classified yet. */
const UNRULED: RequirementGovernance = {
  klass: "FLAG_FOR_RULING",
  ratified: false,
  mandatoryAtFr: null,
  source: "",
};

/** A requirement belonging to a service Effitrans is not providing. */
export const NOT_APPLICABLE_GOVERNANCE: RequirementGovernance = {
  klass: "NOT_APPLICABLE",
  ratified: true,
  mandatoryAtFr: null,
  source: "OPS-SERVICE-SCOPE-01 (ratifié 2026-09-07) — service non contracté sur ce dossier.",
};

export function governanceFor(stepKey: string, requirementKey: string): RequirementGovernance {
  return CLASSIFIED[`${stepKey}::${requirementKey}`] ?? UNRULED;
}

/** Every requirement still awaiting an Effitrans ruling, for the report. */
export function unruledRequirementKeys(pairs: readonly [string, string][]): string[] {
  return pairs
    .filter(([s, r]) => !CLASSIFIED[`${s}::${r}`])
    .map(([s, r]) => `${s}::${r}`);
}

/**
 * Does this requirement stop the step from completing?
 *
 * THE RATIFIED DEFAULT RULE. Only a class Effitrans has ruled BLOCKING blocks.
 * FLAG_FOR_RULING does not — « defaulting every unknown requirement to a
 * blocker is NOT acceptable » — and neither does SOFT, INFORMATIONAL or
 * NOT_APPLICABLE.
 *
 * CONTROLLED_EXCEPTION blocks until somebody exercises the exception, because
 * an exception that applies itself is not a control. No requirement carries
 * that class yet; the branch exists so adding one cannot silently open a gate.
 */
export function blocksCompletion(governance: RequirementGovernance): boolean {
  return governance.klass === "HARD_GATE" || governance.klass === "CONTROLLED_EXCEPTION";
}

/**
 * The requirements that actually stop `submitStep`, from an evidence result.
 *
 * THE SINGLE SOURCE both the surface and the engine read. `unauthorized` is
 * deliberately NOT here: it is an AUTHORITY fact, it is refused by `submitStep`
 * on its own terms with its own sentence, and no classification may soften it.
 */
export function blockingRequirements(stepKey: string, evidence: StepEvidence): EvidenceItem[] {
  return evidence.items.filter(
    (i) =>
      i.status !== "satisfied" &&
      i.status !== "unauthorized" &&
      blocksCompletion(governanceFor(stepKey, i.key)),
  );
}

/**
 * The French an operator reads about ONE outstanding requirement.
 *
 * Two registers, as ratified: « Action requise » for something that genuinely
 * stops the process here, « Information à compléter » for something that should
 * exist and does not stop today's work.
 *
 * WHAT THIS NO LONGER SAYS, and why it mattered: it used to tell operators
 * « Cette exigence est bloquante aujourd'hui ; sa classification est en attente
 * de ratification. » That sentence was internal governance bookkeeping printed
 * on an operator's screen, and on dossier 00011 it presented two unexamined
 * requirements (le Bon à Délivrer, le Pre-Gate) as confirmed blockers. An
 * unknown classification must never masquerade as a settled rule.
 */
export function requirementMessageFr(input: {
  labelFr: string;
  governance: RequirementGovernance;
  blocks: boolean;
}): string {
  const { labelFr, governance, blocks } = input;

  if (governance.klass === "NOT_APPLICABLE") {
    return `Sans objet : ${labelFr} — service non demandé sur ce dossier.`;
  }

  if (blocks) return `Action requise : ${labelFr}.`;

  if (governance.mandatoryAtFr) {
    return `Information à compléter : ${labelFr}. À compléter ${governance.mandatoryAtFr} — vous pouvez poursuivre les opérations autorisées.`;
  }

  if (!governance.ratified) {
    // Truthful and useful: the platform tracks it, nobody has ruled it a
    // blocker, and the operator is not stopped.
    return `Information à compléter : ${labelFr}. Cette exigence n'a pas encore été classifiée comme bloquante — vous pouvez poursuivre les opérations autorisées.`;
  }

  return `Information à compléter : ${labelFr}. Vous pouvez poursuivre les opérations autorisées.`;
}

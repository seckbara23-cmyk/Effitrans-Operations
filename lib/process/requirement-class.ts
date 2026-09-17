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
 * ── AND WHAT 2026-09-17 CORRECTED (OPS-LENIENCY-02) ─────────────────────────
 * The 09-07 reversal went one entry too far. Four transport-readiness
 * requirements were softened although their artefact IS the act their activity
 * performs, and on EFT-IMP-2026-00011 that let « obtenir l'autorisation
 * Pre-Gate » reach COMPLETED while the step itself recorded the authorization
 * as missing. They are HARD again, cited to `ARTEFACT_IS_THE_ACT` below.
 *
 * The doctrine is unchanged and so is rule 1: an unruled requirement still does
 * not block, and softening is still the default for something obtained in
 * parallel. What was wrong was the reading, not the rule — and the correction
 * is narrow: four entries, no new mechanism, and the start of an activity stays
 * free of its completion evidence.
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
const FIELD_AGENT =
  "UAT-STEP12-FIELD-AGENT-01 (ratifié 2026-09-09) — l'étape 12 EST « suivre le dossier en douane ET affecter l'Agent de Terrain » ; le registre le déclarait déjà (completionRule `field_agent_assigned`) sans que rien ne l'applique. L'affectation est le produit gouverné de l'étape et fonde la propriété de l'étape 13 : sans elle l'étape 13 s'ouvre sans titulaire. Ce n'est PAS une exception à la doctrine de souplesse — BAD, Pre-Gate et la convergence restent non bloquants jusqu'à leur point ratifié (étape 15).";
/**
 * OPS-LENIENCY-02 — « l'artefact qui EST l'acte reste bloquant à sa propre
 * activité ». Ratifié le 2026-09-17, après l'audit lecture seule de
 * EFT-IMP-2026-00011.
 *
 * Ce qui s'est passé en production. L'activité « obtenir l'autorisation
 * Pre-Gate » a été démarrée, puis TERMINÉE sans l'autorisation : l'étape a
 * enregistré elle-même « manquant : PRE_GATE_AUTHORIZATION » tout en passant à
 * COMPLETED, et le compteur a affiché « 1/3 activités parallèles ». La porte de
 * convergence, qui lit la preuve directement, répondait au même instant
 * « Autorisation Pre-Gate obtenue (not_uploaded) ». La ligne affirmait un fait
 * qui n'avait pas eu lieu.
 *
 * Pourquoi la souplesse ne s'applique pas ici. La doctrine dit qu'un artefact
 * obtenu EN PARALLÈLE peut attendre son point de contrôle. Ces quatre-là ne
 * sont pas obtenus en parallèle de l'activité : ils SONT l'activité. Le
 * `completionRule` les nomme (`pre_gate_obtained`, `bon_a_delivrer_obtained`,
 * `transport_documents_transmitted`) et l'unique `requiredDocuments` est
 * l'artefact lui-même. Sans lui l'acte n'a pas eu lieu, et le déclarer accompli
 * n'est pas de la souplesse : c'est une affirmation fausse.
 *
 * Ce qui NE change pas. Le démarrage reste libre — on réclame la preuve à la
 * clôture, jamais au début, et une activité peut rester « en cours » le temps
 * d'obtenir le document. Et le registre PICKUP_READINESS continue d'exiger le
 * même artefact à l'étape 15, indépendamment de toute classification : la porte
 * de convergence ne consulte pas cette matrice et ne doit jamais la consulter.
 */
const ARTEFACT_IS_THE_ACT =
  "OPS-LENIENCY-02 (ratifié 2026-09-17) — l'artefact EST l'acte de cette activité : son completionRule le nomme et son unique requiredDocuments est lui. Terminer sans lui affirme un fait qui n'a pas eu lieu (constaté sur EFT-IMP-2026-00011 : Pre-Gate COMPLETED enregistrant « manquant : PRE_GATE_AUTHORIZATION »). Le démarrage reste libre ; la preuve est exigée à la clôture. Supersède la classification SOFT d'OPS-LENIENCY-01 pour ces seules entrées. Le registre PICKUP_READINESS exige toujours le même artefact à l'étape 15, sans consulter cette matrice.";
const OBJECT_OF_THE_ACT =
  "L'artefact EST l'objet de l'acte : l'étape consiste à le remettre ou à le transmettre. Sans lui l'étape n'a pas de contenu, et la chaîne 15→26 étant strictement séquentielle, la laisser passer viderait les étapes suivantes.";
const COTATION =
  "QO-0/QO-1 (ratifié 2026-08-18, docs/commercial/quotation-optional-audit.md) — un dossier PEUT exister sans devis, et le mécanisme ratifié pour cela est le SAUT de l'étape 1 (`skipStep`, motif enregistré, audité, réouvrable), PAS sa clôture à vide. Quand l'étape 1 est vivante, le devis et son acceptation SONT son contenu ; QT609/QT613 (migration 20260806000001) contraignent déjà l'enregistrement de la décision client.";

// `AVANT_ENLEVEMENT` lived here and named the checkpoint the four transport
// artefacts were deferred to. OPS-LENIENCY-02 stopped deferring them, so the
// phrase has no remaining user and is gone rather than left to rot.

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
  "customs_followup::FIELD_AGENT_ASSIGNMENT": hard(FIELD_AGENT),
  "customs_field_clearance::BON_A_ENLEVER": hard(BAE),
  // STEP13-COMPLETION-01 — the release half of step 13's completion rule.
  // Same ruling as the BAE: release safety controls are excluded from every
  // leniency, and TRANSIT-CUSTODY-05 makes the release the Chef-verified act.
  "customs_field_clearance::CUSTOMS_RELEASE": hard(BAE),

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

  // ---- The three transport-readiness activities (OPS-LENIENCY-02) ----------
  //
  // ⚠ REVERSES the SOFT classification OPS-LENIENCY-01 gave these four entries
  // on 2026-09-07. That slice read them as artefacts obtained in parallel and
  // deferred them to the pickup gate; they are not obtained in parallel, they
  // ARE the activity, and deferring them let « obtenir l'autorisation Pre-Gate »
  // reach COMPLETED while recording that the authorization was missing.
  //
  // Each activity keeps its second checkpoint: the pickup gate still refuses
  // step 15 without the same artefact, reading the document directly. What
  // changes is that the activity can no longer claim to be done first.
  "bon_a_delivrer::BON_A_DELIVRER": hard(ARTEFACT_IS_THE_ACT),
  "pre_gate::PRE_GATE_AUTHORIZATION": hard(ARTEFACT_IS_THE_ACT),
  "transport_docs_transmission::PRE_GATE_AUTHORIZATION": hard(ARTEFACT_IS_THE_ACT),
  "transport_docs_transmission::BORDEREAU_LIVRAISON": hard(ARTEFACT_IS_THE_ACT),

  // ---- SOFT: obtained in parallel, enforced at a NAMED later checkpoint ---
  //
  // The POD is the one that genuinely fits that shape, and it stays SOFT: it is
  // obtained DURING the delivery follow-up, from the driver, and is formally
  // handed over at step 17 — which is HARD above and a strict prerequisite of
  // billing. Its artefact is not the act of following the delivery; it is the
  // result the delivery eventually produces.
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

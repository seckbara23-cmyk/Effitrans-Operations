/**
 * Stage-aware evidence requirements (Phase WES-4C). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * ONE resolver. Pages do not maintain independent requirement lists — the audit
 * found `getMissingRequiredDocuments` treating `document_type.required_for` as
 * the whole answer, which is type-aware but NOT stage-aware, NOT mode-aware and
 * NOT policy-driven.
 *
 * The concrete defect that produced: `DELIVERY_NOTE` (POD) is
 * `required_for {IMP, TRP, HND}`, so a POD counts as MISSING from the day a
 * dossier is opened. `getDossierLifecycle` computes `docsVerified = missing===0`,
 * so documentation can never verify until delivery — months later, and long
 * after the department has moved on.
 *
 * ---------------------------------------------------------------------------
 * A DELIBERATE BOUNDARY (ratified for this phase)
 *
 * This resolver is the canonical stage-aware answer, but it is NOT yet wired
 * into `getDossierLifecycle`. Rewiring would change `missingRequired`, which
 * changes the WES-2 projection's `responsibleDepartment`, which changes WES-3
 * visibility and the department queue — silently, for every existing dossier.
 * That reconciliation is WES-5's job and its own decision.
 *
 * So two requirement views coexist for now, and that is recorded rather than
 * hidden: the legacy list still feeds the projection; this one answers
 * "what is actually required, now" for the document surfaces. The duplication
 * is temporary and deliberate, not an oversight.
 */

import { documentDoctrine, type CanonicalStageName } from "./doctrine";

const STAGE_ORDER: readonly CanonicalStageName[] = [
  "draft", "open", "documentation", "customs", "transport", "finance", "archive",
];

function stageIndex(stage: CanonicalStageName): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? 0 : i;
}

/** Every state a required document can be in, from the dossier's point of view. */
export type RequirementState =
  | "satisfied"
  | "under_review"
  | "rejected"
  | "superseded"
  | "missing"
  | "required_later"
  | "not_applicable";

export type EvidenceFact = {
  typeCode: string;
  /** Canonical status of the CURRENT version of this type. */
  status: string;
  supersededById?: string | null;
};

export type RequirementInput = {
  /** IMP · EXP · TRP · HND */
  fileType: string;
  /** From the shipment record, when known. Drives maritime/air applicability. */
  transportMode?: string | null;
  /** Where the dossier actually is, from the WES-2 projection. */
  stage: CanonicalStageName;
  /** Is a customs leg part of this dossier at all? */
  customsApplicable: boolean;
  /**
   * Document type codes the PINNED policy requires, from its `evidence` domain.
   * Empty means policy said nothing — which is NOT the same as "nothing is
   * required"; see `policyResolved`.
   */
  policyRequiredTypes: readonly string[];
  /** False when the pinned policy could not be resolved. Fail closed. */
  policyResolved: boolean;
  facts: readonly EvidenceFact[];
};

export type Requirement = {
  typeCode: string;
  labelFr: string;
  state: RequirementState;
  /** The stage at which this becomes due. */
  dueAtStage: CanonicalStageName;
  /** True when it is due now or overdue. */
  dueNow: boolean;
};

export type RequirementResolution = {
  requirements: Requirement[];
  /** Due now and not satisfied. The only set that should ever block anything. */
  missingNow: Requirement[];
  /** Legitimately not due yet — must never count against current progress. */
  requiredLater: Requirement[];
  satisfied: Requirement[];
  /** False ⇒ the caller must not treat the result as authoritative. */
  resolved: boolean;
};

const EMPTY: RequirementResolution = {
  requirements: [], missingNow: [], requiredLater: [], satisfied: [], resolved: false,
};

/**
 * Mode applicability. A Bill of Lading is not missing from an air shipment and
 * an Air Waybill is not missing from a sea shipment — they are NOT APPLICABLE,
 * which is a different fact and must not read as an outstanding obligation.
 *
 * When the mode is unknown, BOTH are treated as not applicable rather than
 * both required: demanding two mutually exclusive documents because nobody
 * recorded the mode yet would be manufacturing an obligation from missing data.
 */
function modeApplicable(typeCode: string, mode: string | null | undefined): boolean {
  const m = (mode ?? "").toUpperCase();
  if (typeCode === "BILL_OF_LADING") return m === "SEA" || m === "MARITIME" || m === "OCEAN";
  if (typeCode === "AIRWAY_BILL") return m === "AIR";
  return true;
}

export function resolveEvidenceRequirements(
  input: RequirementInput,
): RequirementResolution {
  // Fail closed. An unresolved policy means we do not know what is required,
  // and "nothing" is the one answer that is certainly wrong.
  if (!input.policyResolved) return EMPTY;

  const current = stageIndex(input.stage);
  const factByType = new Map(input.facts.map((f) => [f.typeCode, f]));
  const requirements: Requirement[] = [];

  for (const typeCode of new Set(input.policyRequiredTypes)) {
    const doctrine = documentDoctrine(typeCode);
    // A type the doctrine does not know is not silently required.
    if (!doctrine) continue;

    // An INTERNAL artifact is never external evidence to be chased.
    if (doctrine.category === "INTERNAL_ARTIFACT") continue;

    const applicable =
      modeApplicable(typeCode, input.transportMode) &&
      (doctrine.earliestStage !== "customs" || input.customsApplicable);

    if (!applicable) {
      requirements.push({
        typeCode, labelFr: doctrine.labelFr, state: "not_applicable",
        dueAtStage: doctrine.earliestStage, dueNow: false,
      });
      continue;
    }

    const dueNow = current >= stageIndex(doctrine.earliestStage);
    const fact = factByType.get(typeCode);
    const state = resolveState(fact, dueNow);

    requirements.push({
      typeCode, labelFr: doctrine.labelFr, state,
      dueAtStage: doctrine.earliestStage, dueNow,
    });
  }

  requirements.sort(
    (a, b) => stageIndex(a.dueAtStage) - stageIndex(b.dueAtStage) || a.typeCode.localeCompare(b.typeCode),
  );

  return {
    requirements,
    missingNow: requirements.filter((r) => r.dueNow && (r.state === "missing" || r.state === "rejected")),
    requiredLater: requirements.filter((r) => r.state === "required_later"),
    satisfied: requirements.filter((r) => r.state === "satisfied"),
    resolved: true,
  };
}

function resolveState(fact: EvidenceFact | undefined, dueNow: boolean): RequirementState {
  if (!fact) return dueNow ? "missing" : "required_later";

  if (fact.supersededById) return "superseded";
  switch (fact.status) {
    case "VERIFIED":
    case "APPROVED":
    case "CONSUMED_AS_EVIDENCE":
      return "satisfied";
    case "UNDER_REVIEW":
    case "PENDING_REVIEW":
      return "under_review";
    case "REJECTED":
      return "rejected";
    case "SUPERSEDED":
      return "superseded";
    default:
      // Uploaded but not yet reviewed is not satisfaction — it is an unmet
      // requirement with a file attached.
      return dueNow ? "missing" : "required_later";
  }
}

export const REQUIREMENT_STATE_LABELS_FR: Readonly<Record<RequirementState, string>> = {
  satisfied: "Satisfait",
  under_review: "En cours de vérification",
  rejected: "Rejeté",
  superseded: "Remplacé",
  missing: "Manquant",
  required_later: "Requis ultérieurement",
  not_applicable: "Non applicable",
};

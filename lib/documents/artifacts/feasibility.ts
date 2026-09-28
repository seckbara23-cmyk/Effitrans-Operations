/**
 * Internal-artifact feasibility (Phase WES-4G.1). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * WES-4 classified `TRANSPORT_ORDER` as a Category-B internal artifact but left
 * it uploadable, because nothing generated it. This module answers the question
 * that unblocks that: **can the platform actually produce this artifact from
 * structured data it already holds, without inventing a single fact?**
 *
 * The rule that decides every case: an artifact is generatable only when every
 * MANDATORY field has an authoritative source record. A PDF with a blank where
 * the driver's name belongs is not an incomplete document — it is a document
 * that says there is no driver, which is a different and false claim.
 */

export type FeasibilityVerdict =
  | "GENERATABLE_NOW"
  | "BLOCKED_BY_MISSING_STRUCTURED_DATA"
  | "LEGACY_UPLOAD_TEMPORARILY_REQUIRED"
  | "DEPENDENT_ON_WES_6_MISSION_MODEL";

/**
 * WHEN the platform produces an artifact — a SECOND axis, independent of
 * whether it CAN produce one (FIN-TRN-DOC-01).
 *
 * `GENERATABLE_NOW` answers "does an authoritative source exist for every
 * mandatory field". It does NOT answer "does an operator ask for this", and the
 * artifact panel read the first as though it were the second. `OFFICIAL_INVOICE`
 * is generatable — the platform renders it every time an invoice is issued, once
 * and immutably — but it has no on-demand source rule at all, so the panel
 * offered it, `resolveArtifactSource` found no MANDATORY entry, and the dossier
 * answered « Type non générable » about a document the platform produces
 * reliably. The list was right; the question was wrong.
 *
 * Splitting the axis rather than shortening the list keeps `generatableArtifacts`
 * meaning exactly what WES-4G and UAT-2B ratified, and gives the panel the
 * question it was actually asking.
 */
export type GenerationTrigger =
  /** An authorized operator asks for it on the dossier. */
  | "ON_DEMAND"
  /** Produced as part of ANOTHER act — never on request, never behind a button. */
  | "AT_INVOICE_ISSUANCE"
  /** The platform does not produce it (yet). */
  | "NOT_GENERATED";

export type ArtifactAssessment = {
  code: string;
  labelFr: string;
  verdict: FeasibilityVerdict;
  /** What causes this artifact to exist. Never inferred from the verdict. */
  trigger: GenerationTrigger;
  /** Why, in one line, for the audit trail and the docs. */
  rationale: string;
};

/**
 * What an operator is told about an artifact nobody generates on demand.
 *
 * Names the ACT, not the mechanism: the operator needs to know which step of
 * their own work produces the document, so they stop looking for a button that
 * is correctly absent.
 */
const AUTOMATIC_TRIGGER_FR: Readonly<Record<GenerationTrigger, string | null>> = {
  ON_DEMAND: null,
  AT_INVOICE_ISSUANCE: "Générée automatiquement à l'émission de la facture (étape 22).",
  NOT_GENERATED: null,
};

/**
 * The audit's verdict on every Category-B artifact named in WES-4G.1.
 *
 * `DEMANDE_TRANSPORT` is NEW. The audit found no document type, no request
 * record and no code path for it anywhere in the repository — it did not exist
 * as a concept. Its inputs, however, all do: the dossier, the client, the
 * shipment and the transport record together carry every mandatory field, so
 * it is created here rather than declared missing.
 */
export const ARTIFACT_FEASIBILITY: readonly ArtifactAssessment[] = [
  {
    code: "OFFICIAL_INVOICE",
    labelFr: "Facture Effitrans",
    verdict: "GENERATABLE_NOW",
    trigger: "AT_INVOICE_ISSUANCE",
    rationale:
      "La facture officielle est rendue depuis l'enregistrement Finance et ses lignes persistées : numéro EFT-INV, client, dossier, lignes, totaux et échéance existent tous au moment de l'émission. Elle est générée UNE SEULE FOIS et devient immuable.",
  },
  {
    code: "DEMANDE_TRANSPORT",
    labelFr: "Demande de transport",
    verdict: "GENERATABLE_NOW",
    trigger: "ON_DEMAND",
    rationale:
      "Every mandatory field has an authoritative source: operational_file (number, type), " +
      "client (name), shipment (mode, origin, destination, cargo, container ref) and " +
      "transport_record (pickup/delivery location and planned dates, requester, request date).",
  },
  {
    code: "TRANSPORT_ORDER",
    labelFr: "Ordre de transport",
    verdict: "GENERATABLE_NOW",
    trigger: "ON_DEMAND",
    rationale:
      "Same sources plus the transport assignment — driver, vehicle plate and " +
      "trailer/container. Generation is REFUSED when the assignment is incomplete rather " +
      "than rendering blanks, and no driver or vehicle is ever invented.",
  },
  {
    code: "MISSION_SHEET",
    labelFr: "Feuille de mission",
    verdict: "DEPENDENT_ON_WES_6_MISSION_MODEL",
    trigger: "NOT_GENERATED",
    rationale:
      "A mission sheet describes a MISSION, and no mission entity exists — a transport " +
      "record is not one. Generating it from transport_record would define the mission " +
      "model by accident, which is WES-6's decision to make.",
  },
  {
    code: "DISPATCH_ORDER",
    labelFr: "Bon de dispatch",
    verdict: "BLOCKED_BY_MISSING_STRUCTURED_DATA",
    trigger: "NOT_GENERATED",
    rationale:
      "No dispatch record exists. `readyForDispatch` is a derived COUNT over transport " +
      "statuses, not a dispatch decision with an author, a time and a recipient. There is " +
      "nothing authoritative to render.",
  },
  {
    code: "INTERNAL_MANIFEST",
    labelFr: "Manifeste interne",
    verdict: "BLOCKED_BY_MISSING_STRUCTURED_DATA",
    trigger: "NOT_GENERATED",
    rationale:
      "A manifest enumerates line items — packages, weights, dimensions. The platform " +
      "stores a single free-text cargo_type and no line-item model, so any manifest would " +
      "be a heading over an empty table.",
  },
] as const;

const BY_CODE = new Map(ARTIFACT_FEASIBILITY.map((a) => [a.code, a]));

export function artifactFeasibility(code: string): ArtifactAssessment | null {
  return BY_CODE.get(code) ?? null;
}

/**
 * Artifact types the platform generates today — however it is triggered.
 *
 * UNCHANGED MEANING. This is the feasibility list WES-4G defined and UAT-2B
 * extended; the upload catalogue subtracts it (`!isGeneratableArtifact`) so that
 * nothing the platform authors can also be hand-uploaded. Narrowing it to the
 * on-demand pair would have quietly reopened manual upload of the official
 * invoice, which is the opposite of what FIN-TRN-DOC-01 is for.
 */
export function generatableArtifacts(): ArtifactAssessment[] {
  return ARTIFACT_FEASIBILITY.filter((a) => a.verdict === "GENERATABLE_NOW");
}

export function isGeneratableArtifact(code: string): boolean {
  return artifactFeasibility(code)?.verdict === "GENERATABLE_NOW";
}

/**
 * Artifact types an operator may ASK for on a dossier.
 *
 * The subset `generateArtifact` accepts and the only one the panel offers a
 * Générer button for. Everything else the platform authors arrives through the
 * act that produces it.
 */
export function onDemandArtifacts(): ArtifactAssessment[] {
  return generatableArtifacts().filter((a) => a.trigger === "ON_DEMAND");
}

export function isOnDemandArtifact(code: string): boolean {
  const a = artifactFeasibility(code);
  return a?.verdict === "GENERATABLE_NOW" && a.trigger === "ON_DEMAND";
}

/**
 * The French sentence naming the act that produces this artifact, or null when
 * an operator produces it themselves.
 *
 * Returns null for an unknown code too: saying nothing is correct, inventing a
 * trigger is not.
 */
export function automaticTriggerLabelFr(code: string): string | null {
  const a = artifactFeasibility(code);
  if (!a || a.verdict !== "GENERATABLE_NOW") return null;
  return AUTOMATIC_TRIGGER_FR[a.trigger];
}

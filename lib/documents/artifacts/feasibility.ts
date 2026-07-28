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

export type ArtifactAssessment = {
  code: string;
  labelFr: string;
  verdict: FeasibilityVerdict;
  /** Why, in one line, for the audit trail and the docs. */
  rationale: string;
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
    rationale:
      "La facture officielle est rendue depuis l'enregistrement Finance et ses lignes persistées : numéro EFT-INV, client, dossier, lignes, totaux et échéance existent tous au moment de l'émission. Elle est générée UNE SEULE FOIS et devient immuable.",
  },
  {
    code: "DEMANDE_TRANSPORT",
    labelFr: "Demande de transport",
    verdict: "GENERATABLE_NOW",
    rationale:
      "Every mandatory field has an authoritative source: operational_file (number, type), " +
      "client (name), shipment (mode, origin, destination, cargo, container ref) and " +
      "transport_record (pickup/delivery location and planned dates, requester, request date).",
  },
  {
    code: "TRANSPORT_ORDER",
    labelFr: "Ordre de transport",
    verdict: "GENERATABLE_NOW",
    rationale:
      "Same sources plus the transport assignment — driver, vehicle plate and " +
      "trailer/container. Generation is REFUSED when the assignment is incomplete rather " +
      "than rendering blanks, and no driver or vehicle is ever invented.",
  },
  {
    code: "MISSION_SHEET",
    labelFr: "Feuille de mission",
    verdict: "DEPENDENT_ON_WES_6_MISSION_MODEL",
    rationale:
      "A mission sheet describes a MISSION, and no mission entity exists — a transport " +
      "record is not one. Generating it from transport_record would define the mission " +
      "model by accident, which is WES-6's decision to make.",
  },
  {
    code: "DISPATCH_ORDER",
    labelFr: "Bon de dispatch",
    verdict: "BLOCKED_BY_MISSING_STRUCTURED_DATA",
    rationale:
      "No dispatch record exists. `readyForDispatch` is a derived COUNT over transport " +
      "statuses, not a dispatch decision with an author, a time and a recipient. There is " +
      "nothing authoritative to render.",
  },
  {
    code: "INTERNAL_MANIFEST",
    labelFr: "Manifeste interne",
    verdict: "BLOCKED_BY_MISSING_STRUCTURED_DATA",
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

/** Artifact types the platform generates today. */
export function generatableArtifacts(): ArtifactAssessment[] {
  return ARTIFACT_FEASIBILITY.filter((a) => a.verdict === "GENERATABLE_NOW");
}

export function isGeneratableArtifact(code: string): boolean {
  return artifactFeasibility(code)?.verdict === "GENERATABLE_NOW";
}

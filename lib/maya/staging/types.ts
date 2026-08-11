/**
 * MAYA migration staging — shared types and vocabularies (MAYA-P0.5-C).
 * PURE. Client + server safe. No I/O.
 * ---------------------------------------------------------------------------
 * The pipeline this describes ends at human review:
 *
 *   MAYA offline export → RAW STAGING → NORMALISATION → VALIDATION
 *                       → READY / READY_WITH_WARNINGS / REJECTED → STOP
 *
 * There is no APPLY state here, and none may be added in this phase: the
 * absence is what makes "staging cannot touch production" checkable rather
 * than merely promised.
 */

/** Batch lifecycle. Deliberately has no APPLYING / APPLIED / MIGRATED. */
export const MAYA_BATCH_STATUSES = [
  "STAGED",
  "READY",
  "READY_WITH_WARNINGS",
  "REJECTED",
  "CANCELLED",
] as const;
export type MayaBatchStatus = (typeof MAYA_BATCH_STATUSES)[number];

/**
 * Row outcomes. These four PARTITION a validated batch — every source row
 * lands in exactly one, which is what makes reconciliation provable.
 * PENDING is the pre-validation state and never survives validation.
 */
export const MAYA_ROW_STATUSES = ["PENDING", "VALID", "WARNING", "REJECTED", "DUPLICATE"] as const;
export type MayaRowStatus = (typeof MAYA_ROW_STATUSES)[number];

/** How far the ratified taxonomy could take a MAYA type label. */
export type TaxonomyResolution = "RESOLVED" | "UNRESOLVED" | "UNKNOWN";

/** How a « dossier mère » reference resolved. */
export type ParentResolution = "NONE" | "IN_BATCH" | "EXISTING_DOSSIER" | "UNRESOLVED";

export type IssueSeverity = "WARNING" | "ERROR";

/**
 * Validation issue codes. Closed set: a code the UI cannot label is a code the
 * reviewer cannot act on.
 *
 * NOTE which of these are WARNINGS. Unknown MAYA workflow is not a defect of
 * the export — it is the state of our knowledge (Q1/Q2/Q5), and a row must
 * never be rejected for it.
 */
export const MAYA_ISSUE_CODES = {
  // ---- ERROR: the row cannot be trusted as a record of anything.
  MISSING_SOURCE_IDENTITY: "ERROR",
  INVALID_DATE: "ERROR",
  NEGATIVE_AMOUNT: "ERROR",
  NON_INTEGER_COUNT: "ERROR",
  INVALID_CARGO_FORM: "ERROR",
  SELF_PARENT: "ERROR",
  MALFORMED_PARENT_REFERENCE: "ERROR",
  // ---- DUPLICATE: the row is real but already accounted for.
  DUPLICATE_IN_BATCH: "ERROR",
  DUPLICATE_ACROSS_BATCHES: "ERROR",
  ALREADY_MIGRATED: "ERROR",
  // ---- WARNING: reviewable, never fatal.
  UNRESOLVED_CLIENT: "WARNING",
  UNRESOLVED_PARENT: "WARNING",
  UNKNOWN_TAXONOMY: "WARNING",
  UNRESOLVED_TAXONOMY: "WARNING",
  UNSUPPORTED_COMBINATION: "WARNING",
  MISSING_OPENING_DATE: "WARNING",
} as const;
export type MayaIssueCode = keyof typeof MAYA_ISSUE_CODES;

/** French labels for the review console. One per code, exhaustively. */
export const MAYA_ISSUE_LABELS_FR: Readonly<Record<MayaIssueCode, string>> = {
  MISSING_SOURCE_IDENTITY: "Aucune identité source : ni numéro de dossier ni identifiant d'enregistrement.",
  INVALID_DATE: "Date illisible (format AAAA-MM-JJ attendu).",
  NEGATIVE_AMOUNT: "Quantité, poids ou volume négatif.",
  NON_INTEGER_COUNT: "Nombre de colis ou de conteneurs non entier.",
  INVALID_CARGO_FORM: "Forme de marchandise inconnue.",
  SELF_PARENT: "Le dossier se déclare son propre dossier mère.",
  MALFORMED_PARENT_REFERENCE: "Référence de dossier mère illisible.",
  DUPLICATE_IN_BATCH: "Enregistrement en double dans ce lot.",
  DUPLICATE_ACROSS_BATCHES: "Enregistrement déjà présent dans un lot antérieur.",
  ALREADY_MIGRATED: "Ce dossier MAYA est déjà repris dans la plateforme.",
  UNRESOLVED_CLIENT: "Client MAYA non rapproché d'un client de la plateforme.",
  UNRESOLVED_PARENT: "Dossier mère introuvable — ni dans ce lot, ni déjà repris.",
  UNKNOWN_TAXONOMY: "Type de dossier MAYA non reconnu — libellé conservé tel quel.",
  UNRESOLVED_TAXONOMY: "Type MAYA connu mais non décomposé (question métier ouverte) — libellé conservé.",
  UNSUPPORTED_COMBINATION: "Combinaison sens/mode/forme sans équivalent MAYA connu.",
  MISSING_OPENING_DATE: "Date d'ouverture absente.",
};

export type MayaIssue = {
  code: MayaIssueCode;
  severity: IssueSeverity;
  field: string | null;
  messageFr: string;
};

/** A MAYA source record after normalisation — every field a candidate. */
export type NormalizedRow = {
  sourceTable: string;
  sourceRecordId: string | null;
  sourceDossierReference: string | null;
  sourceParentReference: string | null;
  sourceRowHash: string;

  sourceTypeLabel: string | null;
  normalizedDirection: string | null;
  normalizedMode: string | null;
  normalizedCargoForm: string | null;
  normalizedRegime: string | null;
  taxonomyResolution: TaxonomyResolution;

  clientReferenceRaw: string | null;
  clientNameRaw: string | null;

  openingDate: string | null;
  vesselOrFlight: string | null;
  blAwbRef: string | null;
  originRaw: string | null;
  destinationRaw: string | null;

  goodsDescription: string | null;
  goodsNature: string | null;
  supplierName: string | null;
  cargoQuantity: number | null;
  cargoQuantityUnit: string | null;
  netWeightKg: number | null;
  grossWeightKg: number | null;
  volumeM3: number | null;
  packageCount: number | null;
  containerCount: number | null;
  containerNumbers: string[];

  declarationReference: string | null;
  warehouseEntryDate: string | null;
  processingDueDate: string | null;
  deliveryReference: string | null;

  /** Raw values that failed to parse, kept so validation can name them. */
  malformed: { field: string; value: string }[];
};

/** Reconciliation totals for one batch. */
export type BatchReconciliation = {
  sourceRows: number;
  valid: number;
  warning: number;
  rejected: number;
  duplicate: number;
  /** Overlay on `warning`: rows carrying an unresolved client/parent reference. */
  unresolved: number;
  /** sourceRows === valid + warning + rejected + duplicate. */
  balanced: boolean;
};

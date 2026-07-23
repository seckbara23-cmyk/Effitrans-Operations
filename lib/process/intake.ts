/**
 * Operations intake validation (Phase 9.0C) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * THE typed contract for "is this dossier complete enough to open the official
 * workflow". Distinguishes BLOCKING errors (opening refused) from WARNINGS
 * (opening allowed, information recommended) — deliberately, because BL/AWB,
 * ETA and complete documents often do not exist at intake for a real freight
 * dossier, and a validation that demands them would push staff back to working
 * outside the system.
 *
 * The intake LIFECYCLE reuses existing state — no second enum:
 *   DRAFT              operational_file.status = 'DRAFT' (createFile's default)
 *   READY_FOR_OPENING  derived: DRAFT + validateIntake().blocking is empty
 *   OPEN               process_instance exists + canonical owner assigned
 *                      (+ operational_file transitioned DRAFT → OPENED)
 *   HANDED_TO_TRANSIT  an open/received process_handoff into coordinator_reception
 */

export type IntakeIssueCode =
  | "client_missing"
  | "type_missing"
  | "mode_missing"
  | "owner_missing"
  | "origin_missing"
  | "destination_missing"
  | "reference_missing"
  | "eta_missing"
  | "mode_recommended";

export type IntakeIssue = { code: IntakeIssueCode; labelFr: string };

export type IntakeInput = {
  clientId: string | null;
  /** operational_file.type — IMP / EXP / TRP / HND. */
  fileType: string | null;
  /** shipment.transport_mode — SEA / AIR / ROAD / MULTIMODAL. */
  transportMode: string | null;
  origin: string | null;
  destination: string | null;
  /** Any useful reference: BL/AWB, booking, container, client reference. */
  reference: string | null;
  eta: string | null;
  /** The canonical Operations owner selected for opening. */
  ownerUserId: string | null;
};

export type IntakeValidation = {
  blocking: IntakeIssue[];
  warnings: IntakeIssue[];
  /** True when nothing blocks opening. */
  ready: boolean;
};

const LABELS: Record<IntakeIssueCode, string> = {
  client_missing: "Client obligatoire.",
  type_missing: "Type de dossier obligatoire (IMP / EXP / TRP / HND).",
  mode_missing: "Mode de transport obligatoire pour ce type de dossier.",
  owner_missing: "Un responsable opérationnel (Opérations) doit être sélectionné.",
  origin_missing: "Origine / lieu de départ recommandé.",
  destination_missing: "Destination / lieu d'arrivée recommandé.",
  reference_missing: "Aucune référence utile (BL, AWB, booking, référence client).",
  eta_missing: "ETA non renseignée.",
  mode_recommended: "Mode de transport recommandé.",
};

const issue = (code: IntakeIssueCode): IntakeIssue => ({ code, labelFr: LABELS[code] });

const blank = (v: string | null | undefined): boolean => !v || v.trim().length === 0;

/**
 * Validate minimum intake information.
 *
 * BLOCKING — customer, dossier type, transport mode (for IMP/EXP/TRP — an HND
 * handling dossier may legitimately have none yet), and the Operations owner.
 * WARNING — origin/destination, a useful reference, ETA. BL/AWB/containers/
 * documents are NEVER universally mandatory at intake.
 */
export function validateIntake(input: IntakeInput): IntakeValidation {
  const blocking: IntakeIssue[] = [];
  const warnings: IntakeIssue[] = [];

  if (blank(input.clientId)) blocking.push(issue("client_missing"));
  if (blank(input.fileType)) blocking.push(issue("type_missing"));
  if (blank(input.ownerUserId)) blocking.push(issue("owner_missing"));

  if (blank(input.transportMode)) {
    if (input.fileType === "HND") warnings.push(issue("mode_recommended"));
    else blocking.push(issue("mode_missing"));
  }

  if (blank(input.origin)) warnings.push(issue("origin_missing"));
  if (blank(input.destination)) warnings.push(issue("destination_missing"));
  if (blank(input.reference)) warnings.push(issue("reference_missing"));
  if (blank(input.eta)) warnings.push(issue("eta_missing"));

  return { blocking, warnings, ready: blocking.length === 0 };
}

/**
 * Intake blocker categories that PREVENT the Transit handoff (Phase 9.0C rule:
 * a dossier flagged incomplete does not travel). Other categories — e.g. a
 * payment or supplier issue — do not gate this particular transmission.
 */
export const HANDOFF_BLOCKING_CATEGORIES = ["MISSING_DOCUMENT", "CUSTOMER_RESPONSE_REQUIRED"] as const;

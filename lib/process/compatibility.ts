/**
 * Existing-dossier compatibility mapping (Phase 5.0A) — PURE, read-only.
 * ---------------------------------------------------------------------------
 * Deliverable 15. The Effitrans tenant already holds dossiers created before the
 * official process was modelled. They carry no handoff records, no reception
 * confirmations, no maker-checker signatures and no GAINDE milestones — that
 * evidence was never captured and cannot be reconstructed.
 *
 * This module maps a legacy dossier to the CLOSEST official step from the
 * records that do exist (operational_file.status, customs_record.status,
 * transport_record.status, invoice status, POD). It is deliberately conservative:
 *
 *   - It NEVER marks a step `completed`. Steps before the mapped position are
 *     `assumed` — inferred, not evidenced.
 *   - It NEVER invents evidence. Missing documents stay missing.
 *   - It writes nothing. There is no backfill here, and none should run until
 *     the migration report is reviewed.
 *
 * A dossier created AFTER the Phase 5.0B engine ships will carry real process
 * records and must be read from those, not from this mapper.
 */
import { EFFITRANS_PROCESS, getStep } from "./effitrans-process";

/** How much we actually know about a step's completion. */
export type StepConfidence =
  /** Evidenced by a real record (status, document, milestone). */
  | "derived"
  /** Inferred from a downstream state. The work probably happened; no evidence. */
  | "assumed"
  /** Cannot be determined from existing records at all. */
  | "unverified";

export type CompatibilityInput = {
  fileStatus: string; // DRAFT | OPENED | IN_PROGRESS | DELIVERED | CLOSED | CANCELLED
  fileType: string; // IMP | EXP | TRP | HND
  customs: { status: string; required: boolean } | null;
  transport: { status: string } | null;
  invoices: { status: string; balance: number }[];
  podApproved: boolean;
};

export type CompatibilityMapping = {
  /** Closest official step, or null for CANCELLED / unmappable dossiers. */
  stepNumber: number | null;
  stepKey: string | null;
  confidence: StepConfidence;
  /** Steps before the mapped position — inferred, NOT evidenced. */
  assumedSteps: number[];
  /**
   * Steps whose completion can never be established for this dossier because the
   * platform never captured the evidence. These must render as "non vérifié",
   * never as done.
   */
  unverifiableSteps: number[];
  notes: string[];
};

/**
 * Steps whose evidence the platform has NEVER captured for any dossier. No
 * legacy dossier can be shown as having completed these — there is nothing to
 * read. (Steps 1, 4, 5, 7, 8, 10, 11, 18, 19, 21, 23, 24, 25.)
 */
export const UNVERIFIABLE_STEPS: number[] = EFFITRANS_PROCESS.filter(
  (s) => s.implementation.verdict === "missing",
).map((s) => s.stepNumber);

function issued(invoices: { status: string; balance: number }[]) {
  return invoices.filter((i) => i.status !== "DRAFT" && i.status !== "VOID");
}

function fullyPaid(invoices: { status: string; balance: number }[]) {
  const live = issued(invoices);
  return live.length > 0 && live.every((i) => i.balance <= 0);
}

/**
 * Map a legacy dossier to the closest official step. PURE — no I/O, no writes.
 *
 * The order below walks BACKWARDS from the most advanced signal, so the richest
 * available record wins. Where the platform's routing diverges from the official
 * process, a note records it rather than papering over it.
 */
export function mapDossierToOfficialStep(input: CompatibilityInput): CompatibilityMapping {
  const notes: string[] = [];

  if (input.fileStatus === "CANCELLED") {
    return {
      stepNumber: null,
      stepKey: null,
      confidence: "unverified",
      assumedSteps: [],
      unverifiableSteps: [],
      notes: ["Dossier annulé — hors processus officiel."],
    };
  }

  const paid = fullyPaid(input.invoices);
  const hasIssued = issued(input.invoices).length > 0;
  const hasDraftInvoice = input.invoices.some((i) => i.status === "DRAFT");
  const customsStatus = input.customs?.status ?? null;
  const customsApplies = !!input.customs && input.customs.required;
  const transportStatus = input.transport?.status ?? null;

  let step: number;
  let confidence: StepConfidence = "derived";

  if (input.fileStatus === "CLOSED") {
    step = 26;
    if (!paid) {
      confidence = "unverified";
      notes.push(
        "Dossier CLÔTURÉ sans paiement intégral — la clôture n'était pas conditionnée au paiement (canCloseFile ne contrôle que la mainlevée douane). Ne pas traiter comme un recouvrement abouti.",
      );
    }
  } else if (paid) {
    step = 26;
  } else if (hasIssued) {
    // The invoice went out, but we cannot know whether it was emailed only,
    // prepared for physical deposit, or actually deposited — that split does not exist.
    step = 22;
    confidence = "unverified";
    notes.push(
      "Facture émise, mais la ventilation envoyée / préparée pour dépôt / déposée n'existe pas encore. Étapes 23-25 non vérifiables.",
    );
  } else if (hasDraftInvoice) {
    step = 20;
    notes.push(
      "Facture en brouillon créée sans porte de facturation : les contrôles de complétude (18-19) n'ont jamais existé.",
    );
  } else if (transportStatus === "POD_RECEIVED" || input.podApproved) {
    // Today POD_RECEIVED fires FINANCE_HANDOFF directly, skipping 18 and 19.
    step = 18;
    notes.push(
      "POD reçu. Le POD déclenchait jusqu'ici un transfert direct vers la Finance, en contournant les contrôles de complétude du Coordinateur (18) et de l'Account Manager (19).",
    );
  } else if (transportStatus === "DELIVERED") {
    step = 16;
  } else if (transportStatus === "IN_TRANSIT") {
    step = 16;
    notes.push("En transit — suivi de livraison en cours.");
  } else if (transportStatus === "PICKED_UP") {
    step = 15;
  } else if (transportStatus === "DRIVER_ASSIGNED" || transportStatus === "PLANNED") {
    step = 14;
  } else if (customsStatus === "RELEASED") {
    step = 14;
    notes.push("Mainlevée obtenue, transport pas encore préparé.");
  } else if (customsApplies && customsStatus) {
    switch (customsStatus) {
      case "UNDER_REVIEW":
      case "INSPECTION":
      case "DUTIES_ASSESSED":
        step = 12;
        break;
      case "DECLARED":
        step = 12;
        confidence = "unverified";
        notes.push(
          "Déclaration déposée, mais les jalons GAINDE (enregistrement Finance étape 9, introduction des documents étape 11) n'ont jamais été enregistrés séparément.",
        );
        break;
      case "DECLARATION_PREPARED":
        step = 6;
        confidence = "unverified";
        notes.push("Déclaration préparée — aucune validation Chef de Transit (étape 7) n'a jamais été tracée.");
        break;
      case "DOCUMENTS_PENDING":
        step = 6;
        break;
      case "BLOCKED":
        step = 12;
        notes.push("Dossier douane bloqué.");
        break;
      case "NOT_STARTED":
      default:
        step = 4;
        confidence = "unverified";
        break;
    }
  } else if (input.fileStatus === "IN_PROGRESS" || input.fileStatus === "OPENED") {
    step = 3;
  } else {
    // DRAFT
    step = 3;
    confidence = "unverified";
    notes.push("Dossier en brouillon — l'étape Cotation (1) n'a jamais été modélisée.");
  }

  const assumedSteps = EFFITRANS_PROCESS.filter((s) => s.stepNumber < step).map((s) => s.stepNumber);

  const unverifiableSteps = UNVERIFIABLE_STEPS.filter((n) => n <= step);

  if (unverifiableSteps.length > 0) {
    notes.push(
      `Étapes non vérifiables (preuve jamais capturée par la plateforme) : ${unverifiableSteps.join(", ")}.`,
    );
  }

  const mapped = getStep(EFFITRANS_PROCESS[step - 1].key);

  return {
    stepNumber: step,
    stepKey: mapped ? mapped.key : null,
    confidence,
    assumedSteps,
    unverifiableSteps,
    notes,
  };
}

/**
 * Backfill safety contract. Phase 5.0B must not write a single process record for
 * a legacy dossier until a migration report has been reviewed. These are the
 * rules the backfill has to satisfy.
 */
export const BACKFILL_RULES = {
  /** Never fabricate a completed step, a signature, a milestone or a document. */
  inventEvidence: false,
  /** Never move a dossier's operational_file.status. */
  mutateFileStatus: false,
  /** Never close a dossier. No mass automatic closure. */
  autoClose: false,
  /** Never weaken or bypass RLS. */
  relaxRls: false,
  /** Legacy dossiers keep their existing lifecycle + history untouched. */
  preserveHistory: true,
  /** Steps mapped as `assumed`/`unverified` must render as such in every surface. */
  surfaceUnverified: true,
} as const;

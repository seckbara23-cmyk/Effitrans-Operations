/**
 * Contrôle Qualité N°2 — Account Manager. PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The Effitrans « Manuel de Contrôle Qualité » lists four controls for the
 * Account Manager: ouverture correcte du dossier, vérification des documents,
 * transmission aux opérations, respect des procédures.
 *
 * This module DERIVES what the platform can truthfully say about them from
 * facts the dossier already records. It stores nothing and duplicates nothing:
 * `operational_file` and `document` remain the only places those facts exist.
 *
 * THREE THINGS IT REFUSES TO DO, each for a reason established by census.
 *
 * 1. « OUVERT » IS NOT « OUVERT CORRECTEMENT ». The platform can prove a dossier
 *    exists, when, and under which number — `next_file_number` and the creation
 *    guards make those invariants real. It cannot prove the opening was
 *    *correct*, because Effitrans has defined no additional criterion. So the
 *    fact is reported and the criterion is declared missing, rather than
 *    existence being quietly promoted into a pass.
 *
 * 2. UPLOADED IS NOT VERIFIED. The document authority distinguishes them and so
 *    does this: counts run through `isVerified`, the canonical predicate, so a
 *    pile of unreviewed uploads can never read as verified documents.
 *
 * 3. TRANSMISSION IS NOT DERIVABLE, AND THE EVIDENCE CONFLICTS. See
 *    `QC2_TRANSMISSION_CONFLICT`. Two first-party Effitrans documents disagree
 *    about the direction, and neither handoff mechanism can express it. Naming
 *    the conflict is the honest output; picking a side would manufacture a
 *    process nobody ratified.
 */
import { isVerified, canonicalStatus } from "@/lib/documents/doctrine";
import { formatTenantInstant } from "@/lib/operations/kpi/windows";
import type { DocumentItem } from "@/lib/documents/types";

export type QC2ControlState = "observed" | "absent" | "not_represented" | "restricted";

export type QC2Control = {
  key: string;
  labelFr: string;
  state: QC2ControlState;
  value: string | null;
  reason?: string;
};

/**
 * THE CONFLICT, recorded rather than resolved.
 *
 * The Quality Manual orders the process « ACCOUNT MANAGER → … » and names the
 * control « Transmission aux opérations ». The platform's canonical process
 * registry — itself sourced from the first-party « PROCESSUS OPÉRATIONNEL –
 * EFFITRANS » — runs the other way for that pair: step 2 `operations_intake`
 * (department `operations`) ASSIGNS the dossier TO the Account Manager, and
 * step 3 `am_dossier_opening` then transmits to the **Coordinateur**
 * (`nextSteps: ["coordinator_reception"]`), not back to Operations.
 *
 * Independently, neither handoff mechanism can express the control anyway:
 * `task.handoff_type` admits only CUSTOMS / TRANSPORT / FINANCE / ARCHIVE, and
 * `process_handoff` is keyed on step keys inside a process instance that only
 * exists once the engine is enabled for the dossier.
 *
 * Two first-party documents disagreeing is a business question, not an
 * engineering one.
 */
export const QC2_TRANSMISSION_CONFLICT =
  "Non déterminable : le manuel qualité indique « transmission aux opérations », alors que le processus opérationnel de référence fait l'inverse — les Opérations affectent le dossier à l'Account Manager, qui transmet ensuite au Coordinateur. Aucun mécanisme de transmission existant ne représente ce contrôle.";

export const QC2_NO_PROCEDURE_CRITERIA =
  "Non évalué : aucun référentiel de procédures n'est défini pour ce contrôle.";

export const QC2_NO_OPENING_CRITERIA =
  "Aucun critère d'ouverture supplémentaire n'est défini ; seul le fait est constaté.";

/** What the document authority says, counted through its own canonical states. */
export type QC2DocumentTally = {
  received: number;
  verified: number;
  pendingReview: number;
  rejected: number;
  /** Required by the document-type catalog for this dossier type, and absent. */
  missingRequired: number;
};

/**
 * Count documents by the authority's OWN vocabulary.
 *
 * `received` is every live document — the fact that something arrived.
 * `verified` uses `isVerified`, which is true for VERIFIED and for a document
 * already consumed as evidence, and false for everything else including a bare
 * upload. The three buckets do not have to add up to `received`: SUPERSEDED and
 * EXPIRED are neither pending nor rejected, and inventing a bucket for them
 * would be a second document vocabulary.
 */
export function tallyDocuments(
  documents: readonly DocumentItem[],
  missingRequiredCount: number,
): QC2DocumentTally {
  let verified = 0;
  let pendingReview = 0;
  let rejected = 0;
  for (const d of documents) {
    const s = canonicalStatus(d.status);
    if (isVerified(d.status)) verified++;
    else if (s === "UPLOADED" || s === "UNDER_REVIEW" || s === "PENDING_REVIEW") pendingReview++;
    else if (s === "REJECTED") rejected++;
  }
  return {
    received: documents.length,
    verified,
    pendingReview,
    rejected,
    missingRequired: missingRequiredCount,
  };
}

export type QC2Input = {
  fileNumber: string;
  createdAt: string;
  clientName: string | null;
  /** False when the viewer may not read documents — NOT the same as zero. */
  canReadDocuments: boolean;
  documents: readonly DocumentItem[];
  missingRequiredCount: number;
  timeZone: string;
};

export type QC2Evidence = {
  controls: QC2Control[];
  tally: QC2DocumentTally | null;
};

/** Human-readable document tally, omitting the buckets that are empty. */
export function describeTally(t: QC2DocumentTally): string {
  const parts = [`${t.received} reçu${t.received > 1 ? "s" : ""}`, `${t.verified} vérifié${t.verified > 1 ? "s" : ""}`];
  if (t.pendingReview > 0) parts.push(`${t.pendingReview} en attente`);
  if (t.rejected > 0) parts.push(`${t.rejected} rejeté${t.rejected > 1 ? "s" : ""}`);
  if (t.missingRequired > 0) parts.push(`${t.missingRequired} requis manquant${t.missingRequired > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

export function deriveQC2(input: QC2Input): QC2Evidence {
  // A viewer without document:read gets NO tally — never a zeroed one. Absence
  // of permission is not absence of documents, and the two must not render the
  // same way.
  const tally = input.canReadDocuments
    ? tallyDocuments(input.documents, input.missingRequiredCount)
    : null;

  const controls: QC2Control[] = [
    {
      key: "dossierOpened",
      labelFr: "Ouverture du dossier",
      state: "observed",
      value: `${input.fileNumber} — ouvert le ${formatTenantInstant(input.createdAt, input.timeZone)}${
        input.clientName ? ` pour ${input.clientName}` : ""
      }`,
      reason: QC2_NO_OPENING_CRITERIA,
    },
    {
      key: "documentsVerified",
      labelFr: "Vérification des documents",
      state: !input.canReadDocuments ? "restricted" : tally!.received === 0 ? "absent" : "observed",
      value: tally && tally.received > 0 ? describeTally(tally) : null,
    },
    {
      key: "transmissionToOperations",
      labelFr: "Transmission aux opérations",
      state: "not_represented",
      value: null,
      reason: QC2_TRANSMISSION_CONFLICT,
    },
    {
      key: "procedures",
      labelFr: "Respect des procédures",
      state: "not_represented",
      value: null,
      reason: QC2_NO_PROCEDURE_CRITERIA,
    },
  ];

  return { controls, tally };
}

/**
 * MAYA migration staging — validation (MAYA-P0.5-C). PURE. No I/O.
 * ---------------------------------------------------------------------------
 * Validates STRUCTURAL FACTS ONLY. The distinction this module exists to hold:
 *
 *   an ERROR means the row cannot be trusted as a record of anything
 *   — no identity, an unreadable date, a negative weight, a self-parent;
 *
 *   a WARNING means the row is sound but something about OUR knowledge is
 *   incomplete — an unmatched client, a dossier mère we have not staged yet,
 *   a MAYA type MAYA-0 deliberately did not decompose.
 *
 * UNKNOWN MAYA WORKFLOW IS NEVER AN ERROR. Q1, Q2 and Q5 are unanswered, and a
 * migration that rejected rows for that would be rejecting them for our own
 * open questions. Such rows stay reviewable, with the original MAYA values
 * preserved and the classification honestly marked unresolved.
 *
 * Outcome precedence — the four statuses PARTITION the batch, so precedence
 * must be total: REJECTED (an error) → DUPLICATE (sound but already counted)
 * → WARNING → VALID.
 */
import { isCargoForm } from "@/lib/files/taxonomy";
import { MAYA_ISSUE_CODES, MAYA_ISSUE_LABELS_FR } from "./types";
import type { MayaIssue, MayaIssueCode, MayaRowStatus, NormalizedRow, ParentResolution } from "./types";

/**
 * What the batch and the platform already know. Supplied by the caller (the
 * server action reads it once per batch); this module performs no lookups.
 */
export type ValidationContext = {
  /** Content hashes already seen EARLIER in this same batch. */
  seenHashesInBatch: ReadonlySet<string>;
  /** Content hashes staged by any PRIOR batch in this tenant. */
  hashesInPriorBatches: ReadonlySet<string>;
  /** MAYA dossier references already carried by a platform dossier. */
  migratedDossierReferences: ReadonlySet<string>;
  /** Every dossier reference present in THIS batch (for parent resolution). */
  dossierReferencesInBatch: ReadonlySet<string>;
  /** Client references/names the platform could match. */
  matchableClientKeys: ReadonlySet<string>;
};

export type RowVerdict = {
  status: MayaRowStatus;
  issues: MayaIssue[];
  parentResolution: ParentResolution;
  /** True when the row carries an unresolved client or parent reference. */
  unresolved: boolean;
};

function issue(code: MayaIssueCode, field: string | null): MayaIssue {
  return { code, severity: MAYA_ISSUE_CODES[code], field, messageFr: MAYA_ISSUE_LABELS_FR[code] };
}

const key = (v: string) => v.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();

export function validateRow(row: NormalizedRow, ctx: ValidationContext): RowVerdict {
  const issues: MayaIssue[] = [];

  // ---- identity ----------------------------------------------------------
  if (!row.sourceDossierReference && !row.sourceRecordId) {
    issues.push(issue("MISSING_SOURCE_IDENTITY", "dossier_reference"));
  }

  // ---- shape -------------------------------------------------------------
  for (const m of row.malformed) {
    const dateish = m.field.includes("date");
    issues.push(issue(dateish ? "INVALID_DATE" : "NEGATIVE_AMOUNT", m.field));
  }
  for (const [field, value] of [
    ["quantity", row.cargoQuantity], ["net_weight_kg", row.netWeightKg],
    ["gross_weight_kg", row.grossWeightKg], ["volume_m3", row.volumeM3],
    ["package_count", row.packageCount], ["container_count", row.containerCount],
  ] as const) {
    if (value !== null && value < 0) issues.push(issue("NEGATIVE_AMOUNT", field));
  }
  for (const [field, value] of [
    ["package_count", row.packageCount], ["container_count", row.containerCount],
  ] as const) {
    if (value !== null && !Number.isInteger(value)) issues.push(issue("NON_INTEGER_COUNT", field));
  }
  if (row.normalizedCargoForm !== null && !isCargoForm(row.normalizedCargoForm)) {
    issues.push(issue("INVALID_CARGO_FORM", "type_label"));
  }

  // ---- parent ------------------------------------------------------------
  let parentResolution: ParentResolution = "NONE";
  const parentRef = row.sourceParentReference;
  if (parentRef) {
    if (key(parentRef).length < 2) {
      issues.push(issue("MALFORMED_PARENT_REFERENCE", "parent_reference"));
      parentResolution = "UNRESOLVED";
    } else if (row.sourceDossierReference && key(parentRef) === key(row.sourceDossierReference)) {
      // P0.5-B's database refuses this outright; catching it in staging means
      // the reviewer learns about it before anything is ever applied.
      issues.push(issue("SELF_PARENT", "parent_reference"));
      parentResolution = "UNRESOLVED";
    } else if (ctx.dossierReferencesInBatch.has(key(parentRef))) {
      parentResolution = "IN_BATCH";
    } else if (ctx.migratedDossierReferences.has(key(parentRef))) {
      parentResolution = "EXISTING_DOSSIER";
    } else {
      issues.push(issue("UNRESOLVED_PARENT", "parent_reference"));
      parentResolution = "UNRESOLVED";
    }
  }

  // ---- client ------------------------------------------------------------
  const clientKey = row.clientReferenceRaw ?? row.clientNameRaw;
  const clientUnresolved = !clientKey || !ctx.matchableClientKeys.has(key(clientKey));
  if (clientUnresolved) issues.push(issue("UNRESOLVED_CLIENT", "client_reference"));

  // ---- taxonomy — knowledge gaps, never defects --------------------------
  if (row.taxonomyResolution === "UNRESOLVED") issues.push(issue("UNRESOLVED_TAXONOMY", "type_label"));
  if (row.taxonomyResolution === "UNKNOWN" && row.sourceTypeLabel) {
    issues.push(issue("UNKNOWN_TAXONOMY", "type_label"));
  }
  if (row.taxonomyResolution === "RESOLVED" && !row.normalizedDirection) {
    issues.push(issue("UNSUPPORTED_COMBINATION", "type_label"));
  }
  if (!row.openingDate) issues.push(issue("MISSING_OPENING_DATE", "opening_date"));

  // ---- duplicates --------------------------------------------------------
  const dossierKey = row.sourceDossierReference ? key(row.sourceDossierReference) : null;
  const duplicateInBatch = ctx.seenHashesInBatch.has(row.sourceRowHash);
  const duplicatePrior = ctx.hashesInPriorBatches.has(row.sourceRowHash);
  const alreadyMigrated = dossierKey !== null && ctx.migratedDossierReferences.has(dossierKey);
  if (duplicateInBatch) issues.push(issue("DUPLICATE_IN_BATCH", "source_row_hash"));
  if (duplicatePrior) issues.push(issue("DUPLICATE_ACROSS_BATCHES", "source_row_hash"));
  if (alreadyMigrated) issues.push(issue("ALREADY_MIGRATED", "dossier_reference"));
  const isDuplicate = duplicateInBatch || duplicatePrior || alreadyMigrated;

  // ---- outcome (total precedence) ----------------------------------------
  const fatal = issues.some(
    (i) => i.severity === "ERROR"
      && i.code !== "DUPLICATE_IN_BATCH"
      && i.code !== "DUPLICATE_ACROSS_BATCHES"
      && i.code !== "ALREADY_MIGRATED",
  );
  const status: MayaRowStatus = fatal
    ? "REJECTED"
    : isDuplicate
      ? "DUPLICATE"
      : issues.some((i) => i.severity === "WARNING")
        ? "WARNING"
        : "VALID";

  return {
    status,
    issues,
    parentResolution,
    unresolved: status === "WARNING"
      && issues.some((i) => i.code === "UNRESOLVED_CLIENT" || i.code === "UNRESOLVED_PARENT"),
  };
}

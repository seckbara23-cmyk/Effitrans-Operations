/**
 * Customs Intelligence — persistence mapping (Phase 7.1B). PURE (no I/O).
 * ---------------------------------------------------------------------------
 * Maps a customs_record row (with the additive 7.1B intelligence columns) into the
 * 7.1A Declaration aggregate. REUSES `toDeclaration` — the canonical provider/release
 * facts come from the new columns; everything else is the existing operational record.
 * No duplication of the domain model, and no change to 7.1A.
 */
import { toDeclaration, type Declaration } from "./domain";
import { isDeclarationStatus, type DeclarationStatus } from "./state-machine";
import type { CustomsStatus, InspectionStatus } from "@/lib/customs/types";

/** The customs_record columns the intelligence layer reads (operational + 7.1B intel). */
export const INTEL_RECORD_COLS =
  "id, file_id, status, required, declaration_number, customs_office, regime, declaration_date, " +
  "bae_reference, release_date, inspection_status, external_ref, notes, " +
  "intel_status, provider_code, provider_reference, provider_synced_at, provider_error, " +
  "intel_version, submitted_at, released_at, updated_at";

export type IntelRecordRow = {
  id: string;
  file_id: string;
  status: string;
  required: boolean;
  declaration_number: string | null;
  customs_office: string | null;
  regime: string | null;
  declaration_date: string | null;
  bae_reference: string | null;
  release_date: string | null;
  inspection_status: string;
  external_ref: string | null;
  notes: string | null;
  intel_status: string;
  provider_code: string;
  provider_reference: string | null;
  provider_synced_at: string | null;
  provider_error: string | null;
  intel_version: number;
  submitted_at: string | null;
  released_at: string | null;
  updated_at: string;
};

/** Persistence metadata carried alongside the Declaration (not part of the pure aggregate). */
export type DeclarationMeta = {
  version: number;
  operationalStatus: CustomsStatus;
  providerSyncedAt: string | null;
  providerError: string | null;
  updatedAt: string;
};

/** A Declaration with its persistence metadata — what the console reads. */
export type DeclarationView = { declaration: Declaration; meta: DeclarationMeta };

/** Coerce a stored canonical status, falling back to DRAFT if a row predates a value. */
export function coerceDeclarationStatus(raw: string): DeclarationStatus {
  return isDeclarationStatus(raw) ? (raw as DeclarationStatus) : "DRAFT";
}

/** Build the 7.1A Declaration from a persisted row (reuses toDeclaration). */
export function rowToDeclaration(row: IntelRecordRow): Declaration {
  const record = {
    id: row.id,
    fileId: row.file_id,
    status: row.status as CustomsStatus,
    required: row.required,
    declarationNumber: row.declaration_number,
    customsOffice: row.customs_office,
    regime: row.regime,
    declarationDate: row.declaration_date,
    baeReference: row.bae_reference,
    releaseDate: row.release_date,
    inspectionStatus: row.inspection_status as InspectionStatus,
    externalRef: row.external_ref,
    notes: row.notes,
  };
  const base = toDeclaration(record, {
    status: coerceDeclarationStatus(row.intel_status),
    provider: {
      provider: row.provider_code,
      externalReference: row.provider_reference,
      submittedAt: row.submitted_at,
    },
  });
  // Canonical release fallback: a provider/manual release sets released_at even when no
  // operational BAE reference exists — so clearance time stays measurable either way.
  const release =
    base.release ??
    (row.released_at
      ? { reference: row.provider_reference ?? row.declaration_number ?? "—", releasedAt: row.released_at }
      : null);
  return { ...base, release };
}

/** Build the full console view (Declaration + persistence metadata) from a row. */
export function rowToView(row: IntelRecordRow): DeclarationView {
  return {
    declaration: rowToDeclaration(row),
    meta: {
      version: row.intel_version,
      operationalStatus: row.status as CustomsStatus,
      providerSyncedAt: row.provider_synced_at,
      providerError: row.provider_error,
      updatedAt: row.updated_at,
    },
  };
}

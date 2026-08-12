/**
 * Customs shared types (Phase 1.9). Client + server safe.
 */
export type CustomsStatus =
  | "NOT_STARTED"
  | "DOCUMENTS_PENDING"
  | "DECLARATION_PREPARED"
  | "DECLARED"
  | "UNDER_REVIEW"
  | "INSPECTION"
  | "DUTIES_ASSESSED"
  | "RELEASED"
  | "BLOCKED"
  | "CANCELLED";

export type InspectionStatus = "NOT_REQUIRED" | "PENDING" | "PASSED" | "FAILED";

/** Editable metadata (manual reference tracking — no GAINDE/Orbus). */
export type CustomsInput = {
  declarationNumber?: string | null;
  customsOffice?: string | null;
  regime?: string | null;
  declarationDate?: string | null;
  inspectionStatus?: InspectionStatus;
  externalRef?: string | null;
  notes?: string | null;
  required?: boolean;
};

export type CustomsRecord = {
  id: string;
  fileId: string;
  status: CustomsStatus;
  required: boolean;
  declarationNumber: string | null;
  customsOffice: string | null;
  regime: string | null;
  declarationDate: string | null;
  baeReference: string | null;
  releaseDate: string | null;
  inspectionStatus: InspectionStatus;
  externalRef: string | null;
  notes: string | null;
  /**
   * MAYA-P0.7-A — Quality Control N°3 (Déclarant en Douane). The RECORDED
   * outcome only; the criteria that produced it are deliberately not modelled,
   * because the Quality Manual names the control and not the checklist.
   * `null` = not yet assessed, never "receivable by default".
   */
  receivabilityStatus: string | null;
  receivabilityAt: string | null;
  receivabilityNote: string | null;
  /**
   * MAYA-P0.7-D — how the declaration is driven: 'manual' or 'GAINDE'.
   * PROVENANCE, never a synchronisation claim. GAINDE is reported `unsupported`
   * by the provider config (no API contract — BLK-1), so this reads 'manual' in
   * practice and QC4 must say so rather than imply a live link.
   */
  providerCode: string;
  providerSyncedAt: string | null;
  /**
   * MAYA-P0.8-A — the Chef de Transit validation. An OPERATIONAL fact: it
   * records that a checker other than the preparer validated the record. It is
   * not a Quality verdict and not a lifecycle state.
   */
  reviewedAt: string | null;
  reviewedByEmail: string | null;
};

export type CustomsQueueItem = {
  id: string;
  fileId: string;
  fileNumber: string | null;
  fileType: string | null;
  clientName: string | null;
  status: CustomsStatus;
  declarationNumber: string | null;
  customsOffice: string | null;
  baeReference: string | null;
};

export type MissingCustomsDoc = { code: string; label: string };

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

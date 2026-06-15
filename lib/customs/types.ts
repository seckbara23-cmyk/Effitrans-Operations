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

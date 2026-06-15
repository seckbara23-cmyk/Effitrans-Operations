/**
 * Documents shared types (Phase 1.8). Client + server safe.
 */
import type { ExpiryState } from "./expiry";

export type DocumentStatus =
  | "UPLOADED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED";

export type DocumentTypeItem = {
  code: string;
  labelFr: string;
  category: string;
  hasValidity: boolean;
  requiredFor: string[];
  conditional: boolean;
};

export type DocumentItem = {
  id: string;
  fileId: string;
  typeCode: string;
  typeLabel: string;
  title: string | null;
  status: DocumentStatus;
  version: number;
  expiryDate: string | null;
  expiryState: ExpiryState;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedByEmail: string | null;
  reviewedByEmail: string | null;
  reviewNote: string | null;
  createdAt: string;
};

/** A required document type with no APPROVED instance on the dossier. */
export type MissingDocument = { code: string; label: string };

export type ActionResult =
  | { ok: true; id?: string; url?: string }
  | { ok: false; error: string };

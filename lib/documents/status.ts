/**
 * Document workflow state machine (Phase 1.8) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * UPLOADED -> PENDING_REVIEW -> APPROVED | REJECTED. EXPIRED is DERIVED (see
 * ./expiry) — never a stored transition in the MVP. Re-upload after REJECTED /
 * EXPIRED creates a new version row rather than mutating the old one, so those
 * are terminal here. Mirrors the task/file state-machine pattern (unit-tested).
 */
import type { DocumentStatus } from "./types";

export const DOCUMENT_STATUSES: DocumentStatus[] = [
  "UPLOADED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
];

const ALLOWED: Record<DocumentStatus, DocumentStatus[]> = {
  UPLOADED: ["PENDING_REVIEW", "APPROVED", "REJECTED"],
  PENDING_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function isDocumentStatus(v: string): v is DocumentStatus {
  return (DOCUMENT_STATUSES as string[]).includes(v);
}

export function canTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** A document awaiting a decision can be submitted (UPLOADED only). */
export function canSubmit(status: DocumentStatus): boolean {
  return status === "UPLOADED";
}

/** Approve / reject act on a not-yet-decided document. */
export function canReview(status: DocumentStatus): boolean {
  return status === "UPLOADED" || status === "PENDING_REVIEW";
}

/**
 * Document upload validation (Phase 1.8) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Enforces the approved limits (DEC-B21 D7): ≤ 25 MB, a fixed MIME allow-list,
 * and an expiry date when the document type carries validity. Returns a stable
 * error code (mapped to an i18n message) or null. Unit-tested.
 */
export const MAX_DOCUMENT_BYTES = 26_214_400; // 25 MB

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export type DocumentInput = {
  typeHasValidity: boolean;
  expiryDate?: string | null;
  sizeBytes: number;
  mimeType?: string | null;
};

export function validateDocumentInput(input: DocumentInput): string | null {
  if (!input.sizeBytes || input.sizeBytes <= 0) return "file_required";
  if (input.sizeBytes > MAX_DOCUMENT_BYTES) return "file_too_large";
  if (input.mimeType && !ALLOWED_MIME_TYPES.includes(input.mimeType)) return "invalid_mime";
  if (input.expiryDate && Number.isNaN(Date.parse(input.expiryDate))) return "invalid_expiry_date";
  if (input.typeHasValidity && !input.expiryDate) return "expiry_required";
  return null;
}

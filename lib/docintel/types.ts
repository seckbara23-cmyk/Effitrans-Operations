/**
 * Document Intelligence — closed vocabularies (Phase 7.4A). PURE.
 * ---------------------------------------------------------------------------
 * AI/OCR output are SUGGESTIONS. These vocabularies are the platform's source of truth for
 * document classes, job lifecycle, validation/review/application states, confidence, and the
 * shared provider result codes. Nothing here calls a vendor or writes a record.
 */

/** Supported logistics document classes (own vocabulary; maps from document_type.code). */
export const DOC_CLASSES = [
  "BILL_OF_LADING", "AIR_WAYBILL", "COMMERCIAL_INVOICE", "PACKING_LIST",
  "CERTIFICATE_OF_ORIGIN", "CUSTOMS_DECLARATION", "ARRIVAL_NOTICE", "DELIVERY_ORDER", "UNKNOWN",
] as const;
export type DocClass = (typeof DOC_CLASSES)[number];
export function isDocClass(v: string): v is DocClass {
  return (DOC_CLASSES as readonly string[]).includes(v);
}

/** Map the existing document_type catalog code → a logistics class (UNKNOWN if unmapped). */
export function classFromTypeCode(code: string | null | undefined): DocClass {
  switch (code) {
    case "BILL_OF_LADING": return "BILL_OF_LADING";
    case "AIRWAY_BILL": return "AIR_WAYBILL";
    case "COMMERCIAL_INVOICE": return "COMMERCIAL_INVOICE";
    case "PACKING_LIST": return "PACKING_LIST";
    case "CERTIFICATE_OF_ORIGIN": return "CERTIFICATE_OF_ORIGIN";
    case "CUSTOMS_DECLARATION": return "CUSTOMS_DECLARATION";
    case "DELIVERY_NOTE": return "DELIVERY_ORDER";
    default: return "UNKNOWN";
  }
}

export const JOB_STATUSES = [
  "QUEUED", "CLASSIFYING", "EXTRACTING_TEXT", "EXTRACTING_FIELDS", "VALIDATING",
  "READY_FOR_REVIEW", "PARTIALLY_APPROVED", "APPROVED", "APPLIED", "FAILED", "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CONFIDENCES = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const VALIDATION_STATUSES = ["VALID", "INVALID_FORMAT", "MISSING_REQUIRED_CONTEXT", "CONFLICT", "DUPLICATE", "UNSUPPORTED", "NEEDS_REVIEW"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const RECONCILIATION_STATUSES = ["AGREEMENT", "CONFLICT", "MISSING", "NONE"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const REVIEW_DECISIONS = ["PENDING", "APPROVED", "REJECTED", "EDITED", "IGNORED"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const APPLICATION_RESULTS = ["APPLIED", "FAILED", "SKIPPED", "UNSUPPORTED", "STALE"] as const;
export type ApplicationResult = (typeof APPLICATION_RESULTS)[number];

/** Shared provider result vocabulary — no raw provider error ever reaches the client. */
export const PROVIDER_RESULTS = ["SUCCESS", "NOT_CONFIGURED", "UNSUPPORTED_FILE", "UNSUPPORTED_DOCUMENT", "TOO_LARGE", "TIMEOUT", "RATE_LIMITED", "PROVIDER_ERROR", "INVALID_RESPONSE", "VALIDATION_FAILED"] as const;
export type ProviderResultCode = (typeof PROVIDER_RESULTS)[number];

/** Document languages (explicit; never assumed). */
export const DOC_LANGUAGES = ["FR", "EN", "BILINGUAL", "UNKNOWN"] as const;
export type DocLanguage = (typeof DOC_LANGUAGES)[number];

export const SUPPORTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export function isSupportedMime(mime: string | null | undefined): boolean {
  return !!mime && (SUPPORTED_MIME_TYPES as readonly string[]).includes(mime);
}

const CLASS_LABEL_FR: Record<DocClass, string> = {
  BILL_OF_LADING: "Connaissement (BL)", AIR_WAYBILL: "Lettre de transport aérien (AWB)", COMMERCIAL_INVOICE: "Facture commerciale",
  PACKING_LIST: "Liste de colisage", CERTIFICATE_OF_ORIGIN: "Certificat d'origine", CUSTOMS_DECLARATION: "Déclaration en douane",
  ARRIVAL_NOTICE: "Avis d'arrivée", DELIVERY_ORDER: "Bon de livraison", UNKNOWN: "Inconnu",
};
export function docClassLabel(c: DocClass): string {
  return CLASS_LABEL_FR[c] ?? c;
}

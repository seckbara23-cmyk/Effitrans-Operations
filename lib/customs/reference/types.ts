/**
 * Customs Reference Library — types and the fixed vocabularies. PURE.
 * ---------------------------------------------------------------------------
 * CUSTOMS-REF-01A / REF-1. Client- and server-safe: no I/O, no server-only
 * import, so the UI and the tests can both read these without pulling the
 * service-role client into a bundle.
 *
 * Each vocabulary below mirrors a CHECK constraint in migration 152. The
 * database is the authority; these exist so the application can label and
 * order the values without re-deciding them.
 */

export const REFERENCE_CATEGORIES = [
  "LEGISLATION",
  "TARIFF",
  "REGIME_LIST",
  "EXPLANATORY_NOTES",
  "CIRCULAR",
] as const;
export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];

export const REFERENCE_STATUSES = ["QUARANTINE", "PUBLISHED", "WITHDRAWN"] as const;
export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number];

export const LICENCE_STATUSES = [
  "RESTRICTED",
  "INTERNAL_ONLY",
  "APPROVED_REDISTRIBUTION",
] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export const CATEGORY_LABEL_FR: Record<ReferenceCategory, string> = {
  LEGISLATION: "Code des douanes et textes législatifs",
  TARIFF: "Tarif extérieur commun (TEC)",
  REGIME_LIST: "Liste des régimes douaniers",
  EXPLANATORY_NOTES: "Notes explicatives du Système harmonisé",
  CIRCULAR: "Circulaires et notes de service",
};

export const STATUS_LABEL_FR: Record<ReferenceStatus, string> = {
  QUARANTINE: "En quarantaine",
  PUBLISHED: "Publié",
  WITHDRAWN: "Retiré",
};

export const LICENCE_LABEL_FR: Record<LicenceStatus, string> = {
  RESTRICTED: "Licence non statuée",
  INTERNAL_ONLY: "Consultation interne uniquement",
  APPROVED_REDISTRIBUTION: "Rediffusion autorisée",
};

/**
 * The category whose licence is NOT settled.
 *
 * WCO HS Explanatory Notes are copyrighted and Effitrans has not received the
 * licence terms. Migration 152 refuses to publish this category while its
 * licence is RESTRICTED; this constant is how the UI explains that refusal
 * before the operator runs into it.
 */
export const LICENCE_PENDING_CATEGORIES: readonly ReferenceCategory[] = ["EXPLANATORY_NOTES"];

export type ReferenceDocument = {
  id: string;
  category: ReferenceCategory;
  title: string;
  sourceAuthority: string;
  edition: string | null;
  publishedOn: string | null;
  referenceCode: string;
  version: number;
  supersedesId: string | null;
  supersededById: string | null;
  supersededAt: string | null;
  sizeBytes: number;
  contentSha256: string;
  status: ReferenceStatus;
  licenceStatus: LicenceStatus;
  redistributionAllowed: boolean;
  licenceNote: string | null;
  provenanceVerified: boolean;
  legalVersionVerified: boolean;
  uploadedBy: string;
  uploadedAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  withdrawnAt: string | null;
  notes: string | null;
};

export type ReferenceActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export function isReferenceCategory(v: unknown): v is ReferenceCategory {
  return typeof v === "string" && (REFERENCE_CATEGORIES as readonly string[]).includes(v);
}

export function isLicenceStatus(v: unknown): v is LicenceStatus {
  return typeof v === "string" && (LICENCE_STATUSES as readonly string[]).includes(v);
}

/**
 * Can this document be published, given only what the row says?
 *
 * The same predicate the database enforces, restated so the UI can disable the
 * button and name the missing condition instead of surfacing a constraint
 * violation. The database remains the authority: this never permits anything
 * the CHECK would refuse.
 */
export function publicationBlockers(doc: {
  status: ReferenceStatus;
  category: ReferenceCategory;
  licenceStatus: LicenceStatus;
  provenanceVerified: boolean;
  legalVersionVerified: boolean;
}): string[] {
  const out: string[] = [];
  if (doc.status === "PUBLISHED") out.push("already_published");
  if (doc.status === "WITHDRAWN") out.push("withdrawn");
  if (!doc.provenanceVerified) out.push("provenance_unverified");
  if (!doc.legalVersionVerified) out.push("legal_version_unverified");
  if (doc.licenceStatus === "RESTRICTED") out.push("licence_unresolved");
  if (
    LICENCE_PENDING_CATEGORIES.includes(doc.category)
    && doc.licenceStatus !== "APPROVED_REDISTRIBUTION"
  ) {
    out.push("explanatory_notes_licence_required");
  }
  return out;
}

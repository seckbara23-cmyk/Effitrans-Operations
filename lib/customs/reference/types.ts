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

export const SCAN_STATUSES = [
  "UNSCANNED",
  "SCANNING",
  "CLEAN",
  "INFECTED",
  "ERROR",
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const LICENCE_STATUSES = [
  "RESTRICTED",
  "INTERNAL_ONLY",
  "APPROVED_REDISTRIBUTION",
] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export const SCAN_LABEL_FR: Record<ScanStatus, string> = {
  UNSCANNED: "Non analysé",
  SCANNING: "Analyse en cours",
  CLEAN: "Analyse antivirus : sain",
  INFECTED: "Analyse antivirus : infecté",
  ERROR: "Analyse antivirus : échec",
};

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
  /** REF-2. Normalised, de-duplicated, sorted. Empty = not regime-specific. */
  customsRegimes: string[];
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
  scanStatus: ScanStatus;
  scanCompletedAt: string | null;
  scannerName: string | null;
  scanDetail: string | null;
  submittedForPublicationBy: string | null;
  submittedForPublicationAt: string | null;
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

export function isReferenceStatus(v: unknown): v is ReferenceStatus {
  return typeof v === "string" && (REFERENCE_STATUSES as readonly string[]).includes(v);
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
  scanStatus?: ScanStatus;
  submittedForPublicationBy?: string | null;
  /** The would-be approver, so self-approval is named before it is attempted. */
  approverId?: string | null;
}): string[] {
  const out: string[] = [];
  if (doc.status === "PUBLISHED") out.push("already_published");
  if (doc.status === "WITHDRAWN") out.push("withdrawn");
  if (!doc.provenanceVerified) out.push("provenance_unverified");
  if (!doc.legalVersionVerified) out.push("legal_version_unverified");
  if (doc.licenceStatus === "RESTRICTED") out.push("licence_unresolved");
  // REF-1-PUBLISH-GATE. Only CLEAN passes; UNSCANNED, SCANNING, INFECTED and
  // ERROR are each named so the operator learns which one applies. The database
  // refuses all four regardless — this only explains.
  if (doc.scanStatus !== undefined && doc.scanStatus !== "CLEAN") {
    out.push(
      doc.scanStatus === "UNSCANNED" ? "scan_required"
        : doc.scanStatus === "SCANNING" ? "scan_in_progress"
        : doc.scanStatus === "INFECTED" ? "scan_infected"
        : "scan_error",
    );
  }
  // Maker-checker: something must have been proposed, by someone else.
  if (doc.submittedForPublicationBy !== undefined) {
    if (!doc.submittedForPublicationBy) out.push("not_submitted");
    else if (doc.approverId && doc.approverId === doc.submittedForPublicationBy) {
      out.push("self_approval_forbidden");
    }
  }
  if (
    LICENCE_PENDING_CATEGORIES.includes(doc.category)
    && doc.licenceStatus !== "APPROVED_REDISTRIBUTION"
  ) {
    out.push("explanatory_notes_licence_required");
  }
  return out;
}

/**
 * The four publication states an operator needs to see. REF-2.
 *
 * DERIVED, NEVER STORED. There is no fifth column recording « approved »:
 * readiness is a function of the conditions migration 153 actually checks, so
 * deriving it is what keeps the badge honest. A stored flag would be one more
 * thing that could disagree with the gate.
 *
 * WHY SELF-APPROVAL IS NOT CONSIDERED HERE. `publicationBlockers` also reports
 * `self_approval_forbidden`, which depends on WHO is looking. That is a fact
 * about the viewer, not about the document: the same row would read « ready »
 * to one publisher and « pending » to another, which is not what a status
 * column means. So this answers « is this document ready for somebody to
 * publish? » and the button, which is about the viewer, keeps using
 * `publicationBlockers`.
 */
export type ReferenceLifecycle =
  | "pendingVerification"
  | "approved"
  | "published"
  | "withdrawn";

export function referenceLifecycle(doc: {
  status: ReferenceStatus;
  category: ReferenceCategory;
  licenceStatus: LicenceStatus;
  provenanceVerified: boolean;
  legalVersionVerified: boolean;
  scanStatus: ScanStatus;
}): ReferenceLifecycle {
  if (doc.status === "WITHDRAWN") return "withdrawn";
  if (doc.status === "PUBLISHED") return "published";
  // QUARANTINE. Ready only when every condition the database checks is met —
  // and the scan is one of them, so with no scanner nothing reaches `approved`.
  const blockers = publicationBlockers({
    status: doc.status,
    category: doc.category,
    licenceStatus: doc.licenceStatus,
    provenanceVerified: doc.provenanceVerified,
    legalVersionVerified: doc.legalVersionVerified,
    scanStatus: doc.scanStatus,
  });
  return blockers.length === 0 ? "approved" : "pendingVerification";
}

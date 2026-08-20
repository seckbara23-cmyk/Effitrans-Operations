/**
 * Canonical document doctrine (Phase WES-4A). PURE — client + server safe.
 * ---------------------------------------------------------------------------
 * Three categories, and the distinction is the whole point:
 *
 *   A — EXTERNAL EVIDENCE      originates outside Effitrans; uploaded, then
 *                              verified. The platform did not author it and
 *                              cannot regenerate it.
 *   B — INTERNAL ARTIFACT      the platform authors it FROM structured data.
 *                              Correct the record, then regenerate — never
 *                              upload a replacement, never edit the PDF.
 *   C — STRUCTURED DATA        not a document at all. Driver, vehicle, route,
 *                              ETA, status, references. A PDF of these is a
 *                              printable representation, never the record.
 *
 * The audit found the boundary already broken in one place: `TRANSPORT_ORDER`
 * is an uploadable `document_type`, so an internal artifact is offered as an
 * upload. WES-4 classifies it correctly here; retiring the upload path waits
 * until a generated replacement exists (WES-4G), because removing the only way
 * to record something before there is another way is how data stops being
 * recorded at all.
 */

export type DocumentCategory = "EXTERNAL_EVIDENCE" | "INTERNAL_ARTIFACT";

export type DocumentTypeDoctrine = {
  code: string;
  category: DocumentCategory;
  labelFr: string;
  /** Safe to expose to the customer portal when VERIFIED and current. */
  clientSafe: boolean;
  /**
   * The canonical stage at or after which this evidence can first be required.
   * Requirements are evaluated stage-aware (WES-4C): a POD is not missing
   * during customs preparation, it is simply NOT YET DUE.
   */
  earliestStage: CanonicalStageName;
};

/** Mirrors `CanonicalStageKey` without importing the server-side ladder. */
export type CanonicalStageName =
  | "draft" | "open" | "documentation" | "customs" | "transport" | "finance" | "archive";

/**
 * The ten existing catalog codes plus BAE.
 *
 * BAE is NEW. The audit found the Bon À Enlever existed only as a text string
 * on `customs_record.bae_reference`, with `canRelease()` checking nothing but
 * that the string was non-empty. There was no evidence to verify. The reference
 * stays — it is structured data (category C) — and the official document
 * becomes uploadable evidence beside it.
 */
export const DOCUMENT_DOCTRINE: readonly DocumentTypeDoctrine[] = [
  // ---------------------------------------------------------- category A
  { code: "COMMERCIAL_INVOICE",    category: "EXTERNAL_EVIDENCE", labelFr: "Facture commerciale",        clientSafe: true,  earliestStage: "documentation" },
  { code: "PACKING_LIST",          category: "EXTERNAL_EVIDENCE", labelFr: "Liste de colisage",          clientSafe: true,  earliestStage: "documentation" },
  { code: "BILL_OF_LADING",        category: "EXTERNAL_EVIDENCE", labelFr: "Connaissement (BL)",         clientSafe: true,  earliestStage: "documentation" },
  { code: "AIRWAY_BILL",           category: "EXTERNAL_EVIDENCE", labelFr: "Lettre de transport aérien", clientSafe: true,  earliestStage: "documentation" },
  { code: "CERTIFICATE_OF_ORIGIN", category: "EXTERNAL_EVIDENCE", labelFr: "Certificat d'origine",       clientSafe: true,  earliestStage: "documentation" },
  { code: "CUSTOMS_DECLARATION",   category: "EXTERNAL_EVIDENCE", labelFr: "Déclaration en douane",      clientSafe: false, earliestStage: "customs" },
  // The official Customs authorization. Effitrans RECEIVES it; it does not
  // issue it and does not approve it.
  { code: "BAE",                   category: "EXTERNAL_EVIDENCE", labelFr: "Bon À Enlever (BAE)",        clientSafe: false, earliestStage: "customs" },
  { code: "DELIVERY_NOTE",         category: "EXTERNAL_EVIDENCE", labelFr: "Bon de livraison / POD",     clientSafe: true,  earliestStage: "transport" },
  { code: "PAYMENT_RECEIPT",       category: "EXTERNAL_EVIDENCE", labelFr: "Reçu de paiement",           clientSafe: true,  earliestStage: "finance" },
  { code: "OTHER",                 category: "EXTERNAL_EVIDENCE", labelFr: "Autre document",             clientSafe: false, earliestStage: "documentation" },

  // ---------------------------------------------------------- category B
  // Currently uploadable — the doctrine violation the audit found. Classified
  // correctly here; the upload path is retired only once generation exists.
  { code: "TRANSPORT_ORDER",       category: "INTERNAL_ARTIFACT", labelFr: "Ordre de transport",         clientSafe: false, earliestStage: "transport" },

  // UAT-2B — THE ACCOUNTING DOCUMENT. Effitrans' own service invoice, rendered
  // from the Finance invoice record and its persisted lines, carrying the
  // official EFT-INV number.
  //
  // STRICTLY SEPARATE FROM `COMMERCIAL_INVOICE`, which is the customer's or
  // supplier's external trade invoice — evidence for customs, often in EUR,
  // uploaded by someone else. Nothing may ever fall back from one to the other:
  // they have different authors, different currencies and different legal
  // meaning. `clientSafe` because the customer is its addressee.
  { code: "OFFICIAL_INVOICE",      category: "INTERNAL_ARTIFACT", labelFr: "Facture Effitrans",          clientSafe: true,  earliestStage: "finance" },
] as const;

const BY_CODE = new Map(DOCUMENT_DOCTRINE.map((d) => [d.code, d]));

export function documentDoctrine(code: string): DocumentTypeDoctrine | null {
  return BY_CODE.get(code) ?? null;
}

export function isInternalArtifact(code: string): boolean {
  return documentDoctrine(code)?.category === "INTERNAL_ARTIFACT";
}

export function isClientSafeDocument(code: string): boolean {
  return documentDoctrine(code)?.clientSafe === true;
}

// ---------------------------------------------------------------------------
// WES-4A — the canonical lifecycle
// ---------------------------------------------------------------------------

/**
 * ONE lifecycle for every document version.
 *
 * `PENDING_REVIEW` and `APPROVED` are LEGACY ALIASES, retained because rows
 * already carry them and rewriting history to make the new vocabulary look
 * original would be a lie. They are accepted on read and treated as
 * `UNDER_REVIEW` and `VERIFIED`; nothing writes them any more.
 */
export const DOCUMENT_STATUSES = [
  "UPLOADED",
  "UNDER_REVIEW",
  "VERIFIED",
  "CONSUMED_AS_EVIDENCE",
  "REJECTED",
  "SUPERSEDED",
  "EXPIRED",
  // legacy, read-only
  "PENDING_REVIEW",
  "APPROVED",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const LEGACY_STATUS_ALIAS: Readonly<Record<string, DocumentStatus>> = {
  PENDING_REVIEW: "UNDER_REVIEW",
  APPROVED: "VERIFIED",
};

/** Normalize a stored status to the canonical vocabulary. */
export function canonicalStatus(status: string): DocumentStatus {
  return LEGACY_STATUS_ALIAS[status] ?? (status as DocumentStatus);
}

/**
 * The CANONICAL statuses that count as verified. `isVerified` is derived from
 * this rather than repeating the list, so the two can never disagree.
 */
export const VERIFIED_CANONICAL_STATUSES = ["VERIFIED", "CONSUMED_AS_EVIDENCE"] as const;

/**
 * Every STORED spelling `isVerified` accepts — the canonical ones above plus any
 * legacy alias that maps onto them (today: APPROVED → VERIFIED).
 *
 * For database-level filters, which cannot call `isVerified` because the
 * normalization lives in TypeScript. DERIVED from the alias map on purpose: a
 * `.in("status", [...])` written by hand is exactly how the analytics count
 * drifted out of step and silently under-reported (DEFECT-UAT15d).
 */
export const VERIFIED_STORED_STATUSES: readonly string[] = [
  ...VERIFIED_CANONICAL_STATUSES,
  ...Object.entries(LEGACY_STATUS_ALIAS)
    .filter(([, canonical]) => (VERIFIED_CANONICAL_STATUSES as readonly string[]).includes(canonical))
    .map(([stored]) => stored),
];

export function isVerified(status: string): boolean {
  const s = canonicalStatus(status);
  return (VERIFIED_CANONICAL_STATUSES as readonly string[]).includes(s);
}

/**
 * Legal transitions. Deliberately narrow, and note what is ABSENT:
 *   * nothing returns from SUPERSEDED — a superseded version never becomes
 *     current again by a status change; that would need an explicit governed
 *     action, and WES-4 provides none;
 *   * nothing leaves REJECTED except supersession — a rejected version is not
 *     re-verified in place, it is replaced;
 *   * VERIFIED never returns to UNDER_REVIEW — re-examination means a new
 *     version, so a verified version's meaning is stable forever.
 */
const TRANSITIONS: Readonly<Record<DocumentStatus, readonly DocumentStatus[]>> = {
  UPLOADED: ["UNDER_REVIEW", "REJECTED", "SUPERSEDED", "EXPIRED"],
  UNDER_REVIEW: ["VERIFIED", "REJECTED", "SUPERSEDED"],
  VERIFIED: ["CONSUMED_AS_EVIDENCE", "SUPERSEDED", "EXPIRED"],
  CONSUMED_AS_EVIDENCE: ["SUPERSEDED"],
  REJECTED: ["SUPERSEDED"],
  SUPERSEDED: [],
  EXPIRED: ["SUPERSEDED"],
  // Legacy rows may still move forward through the canonical graph.
  PENDING_REVIEW: ["VERIFIED", "REJECTED", "SUPERSEDED"],
  APPROVED: ["CONSUMED_AS_EVIDENCE", "SUPERSEDED", "EXPIRED"],
};

export function canTransitionDocument(from: string, to: string): boolean {
  const source = TRANSITIONS[from as DocumentStatus];
  return Boolean(source?.includes(to as DocumentStatus));
}

/** A version in a terminal state carries no further obligation. */
export function isTerminalStatus(status: string): boolean {
  const s = canonicalStatus(status);
  return s === "SUPERSEDED" || s === "EXPIRED";
}

/**
 * May this version be shared with the customer (WES-4J)?
 * Three independent conditions, all required.
 */
export function isShareable(input: {
  typeCode: string;
  status: string;
  supersededById: string | null;
}): boolean {
  if (!isClientSafeDocument(input.typeCode)) return false;
  if (input.supersededById) return false;
  return isVerified(input.status);
}

export const DOCUMENT_STATUS_LABELS_FR: Readonly<Record<DocumentStatus, string>> = {
  UPLOADED: "Téléversé",
  UNDER_REVIEW: "En cours de vérification",
  VERIFIED: "Vérifié",
  CONSUMED_AS_EVIDENCE: "Utilisé comme preuve",
  REJECTED: "Rejeté",
  SUPERSEDED: "Remplacé",
  EXPIRED: "Expiré",
  PENDING_REVIEW: "En cours de vérification",
  APPROVED: "Vérifié",
};

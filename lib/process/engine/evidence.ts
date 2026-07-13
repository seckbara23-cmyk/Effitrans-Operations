/**
 * Process engine — evidence checker (Phase 5.0B). PURE. No I/O, no uploads.
 * ---------------------------------------------------------------------------
 * The engine REFERENCES evidence; it never creates a second document system.
 * Everything here reads a snapshot of the EXISTING records — document,
 * customs_record, transport_record, invoice, payment — and answers, per official
 * document key from the 5.0A registry: is it satisfied, missing, invalid, still
 * under review, or not visible to this caller?
 *
 * Two rules worth stating explicitly:
 *   * A document only SATISFIES when it is APPROVED. An uploaded-but-unreviewed
 *     document is `pending_review`, never `satisfied` — a step cannot complete on
 *     the strength of a document nobody has checked.
 *   * Nothing is ever inferred from free text. A BAE reference is a reference; an
 *     empty string is not a BAE.
 */
import { DOCUMENT_MAPPINGS, mapDocument } from "../documents";
import { getNode } from "./state";

export type EvidenceStatus =
  | "satisfied"
  | "missing"
  | "invalid"
  | "pending_review"
  /** The caller lacks the module permission to even see this evidence. */
  | "unauthorized";

export type EvidenceItem = {
  /** Official document key from the registry (e.g. BON_A_ENLEVER). */
  key: string;
  labelFr: string;
  status: EvidenceStatus;
  /** Why it is not satisfied. Never contains document contents. */
  detail?: string;
};

/**
 * A snapshot of the existing records for one dossier. Assembled by the server
 * service with bounded batch reads (no N+1) and handed to this pure function.
 */
export type EvidenceSnapshot = {
  fileType: string;
  /** Which modules the caller may read. An unreadable module yields `unauthorized`. */
  access: {
    documents: boolean;
    customs: boolean;
    transport: boolean;
    finance: boolean;
  };
  /** One entry per document on the dossier. */
  documents: { typeCode: string; status: string }[];
  customs: {
    required: boolean;
    status: string;
    baeReference: string | null;
    declarationNumber: string | null;
    externalRef: string | null;
  } | null;
  transport: {
    status: string;
    vehiclePlate: string | null;
    driverName: string | null;
    driverUserId: string | null;
  } | null;
  invoices: { status: string; balance: number }[];
};

const nonEmpty = (v: string | null | undefined): boolean => typeof v === "string" && v.trim().length > 0;

/** An APPROVED document of this type exists. */
function approvedDoc(snap: EvidenceSnapshot, typeCode: string): boolean {
  return snap.documents.some((d) => d.typeCode === typeCode && d.status === "APPROVED");
}

/** A document of this type exists but has not been approved yet. */
function awaitingReview(snap: EvidenceSnapshot, typeCode: string): boolean {
  return snap.documents.some(
    (d) => d.typeCode === typeCode && (d.status === "UPLOADED" || d.status === "PENDING_REVIEW"),
  );
}

function rejectedDoc(snap: EvidenceSnapshot, typeCode: string): boolean {
  return snap.documents.some((d) => d.typeCode === typeCode && (d.status === "REJECTED" || d.status === "EXPIRED"));
}

/**
 * Resolve ONE official document key against the existing records.
 *
 * Keys whose document type does not exist yet (Phase 5.0D adds ten of them)
 * resolve to `missing` with an explicit detail — never to `satisfied`. The engine
 * must not pretend an artefact is present because the platform cannot store it.
 */
export function checkEvidence(key: string, snap: EvidenceSnapshot): EvidenceItem {
  const mapping = DOCUMENT_MAPPINGS.find((d) => d.key === key);
  const labelFr = mapping?.labelFr ?? key;

  // Structured records, not uploads.
  if (key === "CUSTOMS_DOSSIER") {
    if (!snap.access.customs) return { key, labelFr, status: "unauthorized" };
    if (!snap.customs) return { key, labelFr, status: "missing", detail: "no_customs_record" };
    return { key, labelFr, status: "satisfied" };
  }

  if (key === "GAINDE_DECLARATION_REFERENCE") {
    if (!snap.access.customs) return { key, labelFr, status: "unauthorized" };
    const ref = snap.customs?.externalRef ?? snap.customs?.declarationNumber ?? null;
    // Never infer from free text: an empty/whitespace reference is NOT a reference.
    return nonEmpty(ref)
      ? { key, labelFr, status: "satisfied" }
      : { key, labelFr, status: "missing", detail: "no_gainde_reference" };
  }

  if (key === "BON_A_ENLEVER") {
    if (!snap.access.customs) return { key, labelFr, status: "unauthorized" };
    if (!snap.customs) return { key, labelFr, status: "missing", detail: "no_customs_record" };
    return nonEmpty(snap.customs.baeReference)
      ? { key, labelFr, status: "satisfied" }
      : { key, labelFr, status: "missing", detail: "no_bae_reference" };
  }

  if (key === "FINAL_INVOICE") {
    if (!snap.access.finance) return { key, labelFr, status: "unauthorized" };
    const issued = snap.invoices.filter((i) => i.status !== "DRAFT" && i.status !== "VOID");
    if (issued.length > 0) return { key, labelFr, status: "satisfied" };
    const draft = snap.invoices.some((i) => i.status === "DRAFT");
    return draft
      ? { key, labelFr, status: "pending_review", detail: "invoice_not_validated" }
      : { key, labelFr, status: "missing", detail: "no_invoice" };
  }

  // Everything else is a DOCUMENT in the existing catalog.
  if (!snap.access.documents) return { key, labelFr, status: "unauthorized" };

  const typeCode = mapping?.typeCode ?? null;
  if (!typeCode) {
    // No document type exists for this artefact yet (Phase 5.0D).
    return { key, labelFr, status: "missing", detail: "document_type_not_in_catalog" };
  }

  if (approvedDoc(snap, typeCode)) return { key, labelFr, status: "satisfied" };
  if (awaitingReview(snap, typeCode)) return { key, labelFr, status: "pending_review", detail: "awaiting_approval" };
  if (rejectedDoc(snap, typeCode)) return { key, labelFr, status: "invalid", detail: "rejected_or_expired" };
  return { key, labelFr, status: "missing", detail: "not_uploaded" };
}

export type StepEvidence = {
  items: EvidenceItem[];
  satisfied: string[];
  missing: string[];
  invalid: string[];
  pendingReview: string[];
  unauthorized: string[];
  /** True when nothing is missing/invalid AND nothing is still under review. */
  complete: boolean;
};

/**
 * Evaluate every document a registry step requires.
 *
 * `unauthorized` items do NOT count as satisfied and do NOT block: the caller
 * simply cannot see them, so the engine reports the fact rather than guessing.
 * A step can only COMPLETE when a caller who CAN see the evidence confirms it.
 */
export function evaluateStepEvidence(stepKey: string, snap: EvidenceSnapshot): StepEvidence {
  const node = getNode(stepKey);
  const keys = node?.requiredDocuments ?? [];
  const items = keys.map((k) => checkEvidence(k, snap));

  const pick = (s: EvidenceStatus) => items.filter((i) => i.status === s).map((i) => i.key);
  const missing = pick("missing");
  const invalid = pick("invalid");
  const pendingReview = pick("pending_review");

  return {
    items,
    satisfied: pick("satisfied"),
    missing,
    invalid,
    pendingReview,
    unauthorized: pick("unauthorized"),
    complete: missing.length === 0 && invalid.length === 0 && pendingReview.length === 0,
  };
}

/** Derived: the dossier has issued invoices and none owe a balance. */
export function fullyPaid(snap: EvidenceSnapshot): boolean {
  const issued = snap.invoices.filter((i) => i.status !== "DRAFT" && i.status !== "VOID");
  return issued.length > 0 && issued.every((i) => i.balance <= 0);
}

/** Derived: an APPROVED delivery note (POD) exists on the dossier. */
export function podReceived(snap: EvidenceSnapshot): boolean {
  return approvedDoc(snap, mapDocument("SIGNED_DELIVERY_NOTE").typeCode!);
}

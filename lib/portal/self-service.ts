/**
 * Customer self-service derivations (Phase 3.3B) — PURE, unit-tested. No I/O.
 * ---------------------------------------------------------------------------
 * The rules that decide what a portal customer may do on their OWN dossier:
 * which document types they may upload, which rejected documents they may
 * replace, what is still missing, and the request-update rate limit. Kept pure
 * so the server actions (ownership-verified admin writes + audit) stay thin and
 * the safety rules are testable. Never exposes internal reviewer identity, SLA,
 * risk score, versions of OTHER documents, or Supabase identifiers.
 */

/**
 * Document types a customer may legitimately provide. Excludes documents that
 * Effitrans or the authorities produce (customs declaration, delivery note/POD).
 * A type is uploadable when it is ACTIVE and either in this allow-list OR
 * required for the dossier's file type (so the customer can fulfil a requirement).
 */
export const CUSTOMER_UPLOADABLE_TYPES: readonly string[] = [
  "COMMERCIAL_INVOICE",
  "PACKING_LIST",
  "BILL_OF_LADING",
  "AIRWAY_BILL",
  "CERTIFICATE_OF_ORIGIN",
  "PAYMENT_RECEIPT",
];

/** The document type used for customer-submitted payment proofs. */
export const PAYMENT_PROOF_TYPE = "PAYMENT_RECEIPT";

/** Request-update rate limit: at most one per 12 hours per dossier per customer. */
export const REQUEST_UPDATE_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Contact message bounds (customer-facing free text). */
export const CONTACT_MESSAGE_MIN = 5;
export const CONTACT_MESSAGE_MAX = 2000;

/** Departments a customer may address a contact-center message to. */
export const CONTACT_DEPARTMENTS: readonly string[] = [
  "documentation",
  "customs",
  "transport",
  "finance",
  "general",
];

/**
 * French display label per department — the single source both the legacy
 * contactEffitrans task title and the Messaging Center's conversation title/routing
 * UI use (Phase 8.7), so the two never drift apart.
 */
export const CONTACT_DEPARTMENT_LABELS: Record<string, string> = {
  documentation: "Documentation",
  customs: "Douane",
  transport: "Transport",
  finance: "Finance",
  general: "Général",
};

/**
 * May a customer upload this document type? ACTIVE + (allow-listed OR required
 * for this file type). `requiredForFile` is the type's required_for including
 * the dossier's file type.
 */
export function isCustomerUploadableType(input: {
  code: string;
  active: boolean;
  requiredForFile: boolean;
}): boolean {
  if (!input.active) return false;
  return CUSTOMER_UPLOADABLE_TYPES.includes(input.code) || input.requiredForFile;
}

/** Is a contact-center department code valid? */
export function isValidContactDepartment(dep: string): boolean {
  return CONTACT_DEPARTMENTS.includes(dep);
}

/** Validate a contact message; returns a stable error code or null. */
export function validateContactMessage(message: string): "message_required" | "message_too_long" | null {
  const trimmed = (message ?? "").trim();
  if (trimmed.length < CONTACT_MESSAGE_MIN) return "message_required";
  if (trimmed.length > CONTACT_MESSAGE_MAX) return "message_too_long";
  return null;
}

/**
 * Milliseconds remaining before another request-update is allowed. 0 = allowed
 * now. `lastAt` is the timestamp of the customer's most recent request for this
 * dossier (null = never requested).
 */
export function requestUpdateCooldownMs(lastAt: string | null, now: Date, windowMs = REQUEST_UPDATE_WINDOW_MS): number {
  if (!lastAt) return 0;
  const last = Date.parse(lastAt);
  if (Number.isNaN(last)) return 0;
  const elapsed = now.getTime() - last;
  return elapsed >= windowMs ? 0 : windowMs - elapsed;
}

// ---------------------------------------------------------------- doc picking
export type DocRow = {
  id: string;
  type_code: string;
  status: string;
  review_note: string | null;
  version: number;
  created_at: string;
};

export type LatestDoc = { id: string; status: string; reviewNote: string | null; version: number; createdAt: string };

/**
 * The current document per type: highest version wins, newest created_at breaks
 * ties. Superseded/older versions of the SAME type are never surfaced to the
 * customer (they only ever see their own latest per requirement).
 */
export function latestDocPerType(docs: DocRow[]): Map<string, LatestDoc> {
  const out = new Map<string, LatestDoc>();
  for (const d of docs) {
    const cur = out.get(d.type_code);
    const better =
      !cur ||
      d.version > cur.version ||
      (d.version === cur.version && d.created_at > cur.createdAt);
    if (better) out.set(d.type_code, { id: d.id, status: d.status, reviewNote: d.review_note, version: d.version, createdAt: d.created_at });
  }
  return out;
}

// ------------------------------------------------------- self-service actions
export type RejectedDoc = { docId: string; code: string; label: string; reason: string | null };
export type UploadableType = { code: string; label: string };
export type MissingRequired = { code: string; label: string };

export type SelfServiceActions = {
  /** Rejected documents the customer may replace (latest per type, with reason). */
  rejected: RejectedDoc[];
  /** Required document types with NO document yet — the customer should upload. */
  missingRequired: MissingRequired[];
  /** Types the customer may upload freely (the "add a document" picker). */
  uploadableTypes: UploadableType[];
  /** True when at least one issued invoice still has a balance (payment-proof prompt). */
  hasUnpaidInvoice: boolean;
};

/**
 * Derive the customer's available actions from their OWN dossier signals. Pure —
 * the caller supplies the already-owned rows. Rejected takes precedence over
 * "missing" for the same type (a rejected required doc is a replace, not a fresh
 * upload).
 */
export function buildSelfServiceActions(input: {
  docs: DocRow[];
  requiredCodes: string[];
  labelByCode: Map<string, string>;
  uploadableActiveTypes: { code: string; label: string }[];
  invoices: { status: string; balance: number }[];
}): SelfServiceActions {
  const latest = latestDocPerType(input.docs);
  const labelOf = (code: string) => input.labelByCode.get(code) ?? code;

  const rejected: RejectedDoc[] = [];
  for (const [code, doc] of latest) {
    if (doc.status === "REJECTED") rejected.push({ docId: doc.id, code, label: labelOf(code), reason: doc.reviewNote });
  }
  rejected.sort((a, b) => a.label.localeCompare(b.label));

  const missingRequired: MissingRequired[] = input.requiredCodes
    .filter((code) => !latest.has(code)) // no document at all yet
    .map((code) => ({ code, label: labelOf(code) }));

  const hasUnpaidInvoice = input.invoices.some(
    (i) => (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") && i.balance > 0,
  );

  return {
    rejected,
    missingRequired,
    uploadableTypes: input.uploadableActiveTypes.map((t) => ({ code: t.code, label: t.label })),
    hasUnpaidInvoice,
  };
}

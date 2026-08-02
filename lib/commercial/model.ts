/**
 * EC-3B — quotation lifecycle PRIMITIVES. PURE. Client + server safe.
 * ---------------------------------------------------------------------------
 * The lifecycle frozen in EC-3A, expressed once so the UI, the action layer and
 * the tests agree — while the DATABASE enforces it independently.
 *
 * NOTE ON VALIDITY: there is deliberately no expiry state and no expiry date.
 * Ratified: a quotation has no automatic expiration; it remains valid until
 * business circumstances require a new one. It therefore leaves SENT only by an
 * ACT — accepted, declined, revised, cancelled — never by the passage of time.
 * No scheduler exists in this platform and none was introduced.
 */

export const QUOTATION_STATUSES = [
  "DRAFT", "PENDING_VALIDATION", "VALIDATED", "SENT",
  "ACCEPTED", "DECLINED", "SUPERSEDED", "CANCELLED", "CONVERTED",
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const QUOTATION_STATUS_FR: Record<QuotationStatus, string> = {
  DRAFT: "Brouillon",
  PENDING_VALIDATION: "En attente de validation",
  VALIDATED: "Validée en interne",
  SENT: "Envoyée au client",
  ACCEPTED: "Acceptée",
  DECLINED: "Refusée",
  SUPERSEDED: "Remplacée",
  CANCELLED: "Annulée",
  CONVERTED: "Convertie en dossier",
};

/** States that still occupy the request's single live slot. */
export const LIVE_QUOTATION_STATUSES: readonly QuotationStatus[] = [
  "DRAFT", "PENDING_VALIDATION", "VALIDATED", "SENT",
] as const;

/** Nothing may move out of these. */
export const TERMINAL_QUOTATION_STATUSES: readonly QuotationStatus[] = [
  "SUPERSEDED", "CANCELLED", "CONVERTED",
] as const;

export function isLive(s: QuotationStatus): boolean {
  return (LIVE_QUOTATION_STATUSES as readonly string[]).includes(s);
}
export function isTerminal(s: QuotationStatus): boolean {
  return (TERMINAL_QUOTATION_STATUSES as readonly string[]).includes(s);
}
/** Content is frozen from SENT onward — a sent quotation is customer evidence. */
export function isFrozen(s: QuotationStatus): boolean {
  return !["DRAFT", "PENDING_VALIDATION", "VALIDATED"].includes(s);
}

export const ACCEPTANCE_KINDS = ["SIGNED_QUOTATION", "EMAIL", "WRITTEN_AGREEMENT"] as const;
export type AcceptanceKind = (typeof ACCEPTANCE_KINDS)[number];

export const ACCEPTANCE_KIND_FR: Record<AcceptanceKind, string> = {
  SIGNED_QUOTATION: "Cotation signée par le client",
  EMAIL: "Acceptation par courriel",
  WRITTEN_AGREEMENT: "Accord écrit explicite",
};

export function isAcceptanceKind(v: string): v is AcceptanceKind {
  return (ACCEPTANCE_KINDS as readonly string[]).includes(v);
}

export const REQUEST_STATUSES = ["OPEN", "QUOTED", "WON", "LOST", "ABANDONED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_FR: Record<RequestStatus, string> = {
  OPEN: "Ouverte",
  QUOTED: "Cotation envoyée",
  WON: "Gagnée",
  LOST: "Perdue",
  ABANDONED: "Abandonnée",
};

/**
 * The legal forward transitions. The database enforces these independently;
 * this exists so a UI can disable an impossible action instead of offering it
 * and letting the server refuse.
 */
const ALLOWED: Record<QuotationStatus, readonly QuotationStatus[]> = {
  DRAFT: ["PENDING_VALIDATION", "SUPERSEDED", "CANCELLED"],
  PENDING_VALIDATION: ["VALIDATED", "DRAFT", "SUPERSEDED", "CANCELLED"],
  VALIDATED: ["SENT", "SUPERSEDED", "CANCELLED"],
  SENT: ["ACCEPTED", "DECLINED", "SUPERSEDED", "CANCELLED"],
  ACCEPTED: ["CONVERTED", "CANCELLED"],
  DECLINED: ["SUPERSEDED"],
  SUPERSEDED: [],
  CANCELLED: [],
  CONVERTED: [],
};

export function canTransition(from: QuotationStatus, to: QuotationStatus): boolean {
  return (ALLOWED[from] as readonly string[]).includes(to);
}

export type AcceptanceInput = {
  kind: string;
  on?: string | null;
  documentId?: string | null;
  messageId?: string | null;
};

export type AcceptanceProblem = "invalid_kind" | "invalid_date";

/**
 * Acceptance is EVIDENCE, and evidence has a kind. What it deliberately does
 * NOT require is a document: an "explicit written agreement" may live in a
 * customer's letter that nobody scanned, and demanding an upload would push
 * staff to record a false kind. Whether evidence should be mandatory per kind
 * is MD-Q4 — unanswered, so nothing is invented.
 */
export function validateAcceptance(input: AcceptanceInput): AcceptanceProblem | null {
  if (!isAcceptanceKind(input.kind)) return "invalid_kind";
  if (input.on && !/^\d{4}-\d{2}-\d{2}$/.test(input.on)) return "invalid_date";
  return null;
}

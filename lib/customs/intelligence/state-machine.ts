/**
 * Customs Intelligence — canonical declaration lifecycle (Phase 7.1A). PURE.
 * ---------------------------------------------------------------------------
 * The provider-driven state machine (GAINDE / ORBUS in 7.1B). Distinct from the internal
 * operational status (lib/customs/status.ts). Transitions are EXPLICIT and validated;
 * COMPLETED / REJECTED / CANCELLED are terminal. Same shape/discipline as the existing
 * customs + file + task state machines (tested).
 */
export const DECLARATION_STATUSES = [
  "DRAFT", "SUBMITTED", "ACCEPTED", "UNDER_REVIEW", "INSPECTION", "AWAITING_PAYMENT", "RELEASED", "COMPLETED", "REJECTED", "CANCELLED",
] as const;
export type DeclarationStatus = (typeof DECLARATION_STATUSES)[number];

const ALLOWED: Record<DeclarationStatus, DeclarationStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["UNDER_REVIEW", "INSPECTION", "AWAITING_PAYMENT", "CANCELLED"],
  UNDER_REVIEW: ["INSPECTION", "AWAITING_PAYMENT", "REJECTED", "CANCELLED"],
  INSPECTION: ["AWAITING_PAYMENT", "REJECTED", "CANCELLED"],
  AWAITING_PAYMENT: ["RELEASED", "CANCELLED"],
  RELEASED: ["COMPLETED"],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function isDeclarationStatus(v: string): v is DeclarationStatus {
  return (DECLARATION_STATUSES as readonly string[]).includes(v);
}

export function nextStatuses(from: DeclarationStatus): DeclarationStatus[] {
  return ALLOWED[from] ?? [];
}

export function canTransition(from: DeclarationStatus, to: DeclarationStatus): boolean {
  return nextStatuses(from).includes(to);
}

export function isTerminal(status: DeclarationStatus): boolean {
  return status === "COMPLETED" || status === "REJECTED" || status === "CANCELLED";
}

/** A declaration is "cleared" (goods releasable) once RELEASED or COMPLETED. */
export function isCleared(status: DeclarationStatus): boolean {
  return status === "RELEASED" || status === "COMPLETED";
}

export type TransitionResult = { ok: true } | { ok: false; reason: "invalid_transition" | "terminal" };

/** Validate a transition, giving a typed reason on refusal (for the engine + audit). */
export function validateTransition(from: DeclarationStatus, to: DeclarationStatus): TransitionResult {
  if (isTerminal(from)) return { ok: false, reason: "terminal" };
  if (!canTransition(from, to)) return { ok: false, reason: "invalid_transition" };
  return { ok: true };
}

const LABEL_FR: Record<DeclarationStatus, string> = {
  DRAFT: "Brouillon", SUBMITTED: "Soumise", ACCEPTED: "Acceptée", UNDER_REVIEW: "En cours d'examen",
  INSPECTION: "Inspection", AWAITING_PAYMENT: "En attente de paiement", RELEASED: "Mainlevée",
  COMPLETED: "Clôturée", REJECTED: "Rejetée", CANCELLED: "Annulée",
};
export function declarationLabel(status: DeclarationStatus): string {
  return LABEL_FR[status] ?? status;
}

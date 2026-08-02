/**
 * EC-2 — triage PRIMITIVES. PURE. No imports, no I/O, no server-only.
 * ---------------------------------------------------------------------------
 * The client workspace needs the vocabulary and the outcome rules; a
 * `server-only` module cannot cross that boundary (the lesson from HR-6).
 *
 * WHAT IS NOT HERE, DELIBERATELY: any notion of quarantine as a triage choice.
 * Quarantine is EC-1's capture-time verdict for UNROUTABLE mail (tenant_id
 * NULL, visible to nobody). A triager only ever sees routed mail, so the word
 * has no meaning in this module and no second quarantine concept exists.
 */

/** The four ratified outcomes (Q-EC2-1). There is no fifth. */
export const TRIAGE_OUTCOMES = [
  "ATTACH_TO_DOSSIER",
  "HANDOFF_TO_QUOTATION",
  "GENERAL_CORRESPONDENCE",
  "DISCARD",
] as const;
export type TriageOutcome = (typeof TRIAGE_OUTCOMES)[number];

export const TRIAGE_OUTCOME_FR: Record<TriageOutcome, string> = {
  ATTACH_TO_DOSSIER: "Rattacher à un dossier existant",
  HANDOFF_TO_QUOTATION: "Orienter vers une demande de cotation",
  GENERAL_CORRESPONDENCE: "Correspondance générale",
  DISCARD: "Rejeter",
};

/**
 * Discard reason vocabulary — TENANT CONFIGURATION, not a schema enum.
 * The database enforces that a reason is PRESENT; this list is what the UI
 * offers. Adding a reason needs no migration (the `cycle_kind` idiom).
 */
export const DISCARD_REASON_CODES = [
  "SPAM",
  "DUPLICATE",
  "NOT_BUSINESS_RELATED",
  "WRONG_RECIPIENT",
  "UNSOLICITED",
  "OTHER",
] as const;
export type DiscardReasonCode = (typeof DISCARD_REASON_CODES)[number];

export const DISCARD_REASON_FR: Record<DiscardReasonCode, string> = {
  SPAM: "Pourriel",
  DUPLICATE: "Doublon",
  NOT_BUSINESS_RELATED: "Sans rapport avec l'activité",
  WRONG_RECIPIENT: "Mauvais destinataire",
  UNSOLICITED: "Sollicitation non désirée",
  OTHER: "Autre",
};

export function isDiscardReasonCode(v: string): v is DiscardReasonCode {
  return (DISCARD_REASON_CODES as readonly string[]).includes(v);
}

export type TriageStatus = "NEW" | "ASSIGNED" | "IN_REVIEW" | "RESOLVED" | "QUARANTINED";

export const TRIAGE_STATUS_FR: Record<TriageStatus, string> = {
  NEW: "Nouveau",
  ASSIGNED: "Attribué",
  IN_REVIEW: "En cours d'examen",
  RESOLVED: "Traité",
  QUARANTINED: "En quarantaine (non routable)",
};

/** Statuses a triager can still act on. RESOLVED and QUARANTINED are terminal. */
export const OPEN_TRIAGE_STATUSES: readonly TriageStatus[] = ["NEW", "ASSIGNED", "IN_REVIEW"] as const;

export function isOpen(status: TriageStatus): boolean {
  return (OPEN_TRIAGE_STATUSES as readonly string[]).includes(status);
}

export type OutcomeInput = {
  outcome: TriageOutcome;
  fileId?: string | null;
  clientId?: string | null;
  reasonCode?: string | null;
  comment?: string | null;
};

export type OutcomeProblem =
  | "invalid_outcome"
  | "dossier_required"
  | "reason_required"
  | "invalid_reason"
  | "dossier_not_allowed"
  | "reason_not_allowed";

/**
 * The outcome rules, stated once and shared by the UI and the action layer.
 * The database enforces the same constraints independently — this exists so a
 * user sees why a choice is incomplete BEFORE the server refuses it, never as
 * the only line of defence.
 */
export function validateOutcome(input: OutcomeInput): OutcomeProblem | null {
  if (!(TRIAGE_OUTCOMES as readonly string[]).includes(input.outcome)) return "invalid_outcome";

  const hasFile = Boolean(input.fileId);
  const reason = input.reasonCode?.trim() ?? "";

  if (input.outcome === "ATTACH_TO_DOSSIER") {
    if (!hasFile) return "dossier_required";
    if (reason) return "reason_not_allowed";
    return null;
  }
  if (input.outcome === "DISCARD") {
    if (!reason) return "reason_required";
    if (!isDiscardReasonCode(reason)) return "invalid_reason";
    if (hasFile) return "dossier_not_allowed";
    return null;
  }
  // HANDOFF_TO_QUOTATION and GENERAL_CORRESPONDENCE carry neither.
  if (hasFile) return "dossier_not_allowed";
  if (reason) return "reason_not_allowed";
  return null;
}

/**
 * Suggest an outcome from the mailbox purpose. A SUGGESTION — the human
 * chooses, and nothing is pre-selected on the user's behalf when the mailbox
 * says nothing useful. Returns null rather than guessing.
 */
export function suggestOutcome(mailboxPurpose: string | null): TriageOutcome | null {
  if (mailboxPurpose === "QUOTATION") return "HANDOFF_TO_QUOTATION";
  return null;
}

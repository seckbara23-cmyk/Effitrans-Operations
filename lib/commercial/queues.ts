/**
 * EC-3C — role-sensitive commercial queues. PURE.
 * ---------------------------------------------------------------------------
 * No I/O, no client, no session: partitions a list of quotations into the named
 * work queues and decides what each role may DO with each one. Pure so the
 * rules are testable without a database, and so the page, the detail view and
 * the tests all answer "may I?" the same way.
 *
 * The doctrine here is "do not expose actions users cannot perform". Every
 * capability below mirrors a gate that already exists in the server action and,
 * for the maker-checker, in a database CHECK. The UI is the THIRD place the rule
 * is stated and the only one that is not load-bearing — if these ever disagree,
 * the action and the constraint win and the user gets an error rather than a
 * silent success.
 */
import type { QuotationStatus } from "./model";

export const QUOTATION_READ = "quotation:create";
export const QUOTATION_VALIDATE = "quotation:validate";
export const QUOTATION_SEND = "quotation:send";
export const QUOTATION_APPROVE = "quotation:approve";

/** The minimum a quotation-shaped row must carry to be queued and judged. */
export type QueueableQuotation = {
  id: string;
  status: QuotationStatus;
  preparedBy: string | null;
  version: number;
};

export type CommercialQueueKey =
  | "drafts"
  | "awaitingValidation"
  | "readyToSend"
  | "sent"
  | "accepted"
  | "declined"
  | "cancelled";

export const QUEUE_LABEL_FR: Record<CommercialQueueKey, string> = {
  drafts: "Brouillons",
  awaitingValidation: "En attente de validation",
  readyToSend: "Validées — prêtes à envoyer",
  sent: "Envoyées — en attente de réponse client",
  accepted: "Acceptées",
  declined: "Refusées par le client",
  cancelled: "Annulées",
};

const QUEUE_STATUS: Record<CommercialQueueKey, QuotationStatus[]> = {
  drafts: ["DRAFT"],
  awaitingValidation: ["PENDING_VALIDATION"],
  readyToSend: ["VALIDATED"],
  sent: ["SENT"],
  accepted: ["ACCEPTED", "CONVERTED"],
  declined: ["DECLINED"],
  cancelled: ["CANCELLED"],
};

/**
 * Which queues a holder of these permissions should be SHOWN.
 *
 * An agent works the preparation and customer-facing side; a supervisor works
 * validation. A supervisor is not shown "Brouillons": drafts are the agent's
 * private workspace and a supervisor can neither edit nor act on one. They ARE
 * shown the outcome queues, because validation history is part of their job —
 * "items returned for correction" is exactly `drafts` from the agent's side and
 * is surfaced to the supervisor through the rejected quotations they acted on.
 */
export function visibleQueues(permissions: readonly string[]): CommercialQueueKey[] {
  const agent = permissions.includes(QUOTATION_READ);
  const validator = permissions.includes(QUOTATION_VALIDATE);
  const out: CommercialQueueKey[] = [];
  if (agent) out.push("drafts");
  if (agent || validator) out.push("awaitingValidation");
  if (agent) out.push("readyToSend", "sent");
  if (agent || validator) out.push("accepted", "declined", "cancelled");
  return out;
}

export function partition<T extends QueueableQuotation>(
  quotations: readonly T[],
): Record<CommercialQueueKey, T[]> {
  const out = {} as Record<CommercialQueueKey, T[]>;
  for (const key of Object.keys(QUEUE_STATUS) as CommercialQueueKey[]) {
    out[key] = quotations.filter((q) => QUEUE_STATUS[key].includes(q.status));
  }
  return out;
}

/* ========================================================================== */
/* Capabilities — one function per act, mirroring the server-side gate         */
/* ========================================================================== */

/** Draft lines may be edited only by an agent, and only while still a draft. */
export function canEditLines(q: QueueableQuotation, permissions: readonly string[]): boolean {
  return permissions.includes(QUOTATION_READ) && q.status === "DRAFT";
}

export function canSubmit(q: QueueableQuotation, permissions: readonly string[]): boolean {
  return permissions.includes(QUOTATION_READ) && q.status === "DRAFT";
}

/**
 * The maker-checker, surfaced. A validator may act only on a quotation awaiting
 * validation that they did NOT prepare. The database enforces the same rule
 * through `quotation_validator_differs` and the RPC through QT606 — this exists
 * so the button is absent rather than presented-and-refused.
 */
export function canValidate(
  q: QueueableQuotation, permissions: readonly string[], actorId: string,
): boolean {
  return (
    permissions.includes(QUOTATION_VALIDATE) &&
    q.status === "PENDING_VALIDATION" &&
    q.preparedBy !== actorId
  );
}

/** Why validation is unavailable, in French, when the actor is the preparer. */
export function validationBlockedReason(
  q: QueueableQuotation, permissions: readonly string[], actorId: string,
): string | null {
  if (!permissions.includes(QUOTATION_VALIDATE)) return null;
  if (q.status !== "PENDING_VALIDATION") return null;
  if (q.preparedBy === actorId) {
    return "Vous avez préparé cette cotation : sa validation revient à une autre personne (séparation des tâches).";
  }
  return null;
}

/** Sending requires the send authority AND a quotation that has been validated. */
export function canSend(q: QueueableQuotation, permissions: readonly string[]): boolean {
  return permissions.includes(QUOTATION_SEND) && q.status === "VALIDATED";
}

/** The customer's decision may only be recorded once the offer actually went out. */
export function canRecordDecision(q: QueueableQuotation, permissions: readonly string[]): boolean {
  return permissions.includes(QUOTATION_APPROVE) && q.status === "SENT";
}

/** A revision may be raised from any state that is no longer live-editable. */
export function canRevise(q: QueueableQuotation, permissions: readonly string[]): boolean {
  return (
    permissions.includes(QUOTATION_READ) &&
    (q.status === "SENT" || q.status === "DECLINED" || q.status === "VALIDATED")
  );
}

export function canCancel(q: QueueableQuotation, permissions: readonly string[]): boolean {
  return (
    permissions.includes(QUOTATION_READ) &&
    ["DRAFT", "PENDING_VALIDATION", "VALIDATED", "SENT"].includes(q.status)
  );
}

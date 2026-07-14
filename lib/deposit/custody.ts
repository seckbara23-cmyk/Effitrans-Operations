/**
 * Physical deposit — chain of custody (Phase 5.0D-3). PURE.
 * ---------------------------------------------------------------------------
 * The custody chain is the HISTORY; invoice_deposit.status is the CURRENT state.
 * Custody is never inferred from the current status alone, and a custody event is
 * never rewritten (the table is append-only, trigger-enforced).
 *
 * Mirrors the existing file_state_transition pattern — this is a shape the
 * codebase already has, not a new one.
 */
import type { DepositStatus } from "./status";

export const CUSTODY_EVENTS = [
  "WORKFLOW_CREATED",
  "HANDED_TO_ADMIN",
  "ADMIN_RECEIVED",
  "PACKAGE_PREPARED",
  "COURIER_ASSIGNED",
  "COURIER_REASSIGNED",
  "COURIER_ACCEPTED",
  "COURIER_DECLINED",
  "DEPOSIT_STARTED",
  "DEPOSIT_FAILED",
  "INVOICE_DEPOSITED",
  "PROOF_UPLOADED",
  "PROOF_SUBMITTED",
  "PROOF_ACCEPTED",
  "PROOF_REJECTED",
  "HANDED_TO_COLLECTIONS",
  "CANCELLED",
] as const;

export type CustodyEvent = (typeof CUSTODY_EVENTS)[number];

/** Departments the custody chain moves between. */
export type CustodyDept = "billing" | "administration" | "courier" | "collections";

export const CUSTODY_LABEL_FR: Record<CustodyEvent, string> = {
  WORKFLOW_CREATED: "Circuit de dépôt créé",
  HANDED_TO_ADMIN: "Facture transmise à l'Administration",
  ADMIN_RECEIVED: "Réception confirmée par l'Administration",
  PACKAGE_PREPARED: "Pli préparé",
  COURIER_ASSIGNED: "Coursier affecté",
  COURIER_REASSIGNED: "Coursier réaffecté",
  COURIER_ACCEPTED: "Mission acceptée par le coursier",
  COURIER_DECLINED: "Mission déclinée par le coursier",
  DEPOSIT_STARTED: "Départ du coursier",
  DEPOSIT_FAILED: "Dépôt échoué",
  INVOICE_DEPOSITED: "Facture déposée chez le client",
  PROOF_UPLOADED: "Preuve de dépôt téléversée",
  PROOF_SUBMITTED: "Preuve transmise à l'Administration",
  PROOF_ACCEPTED: "Preuve validée",
  PROOF_REJECTED: "Preuve rejetée",
  HANDED_TO_COLLECTIONS: "Remis au recouvrement",
  CANCELLED: "Circuit annulé",
};

/**
 * The official custody sequence. Every transition must move BETWEEN these
 * departments — a custody event that does not name a source and a destination is
 * not a custody event.
 */
export const CUSTODY_ROUTE: Record<CustodyEvent, { from: CustodyDept | null; to: CustodyDept }> = {
  WORKFLOW_CREATED: { from: null, to: "billing" },
  HANDED_TO_ADMIN: { from: "billing", to: "administration" },
  ADMIN_RECEIVED: { from: "billing", to: "administration" },
  PACKAGE_PREPARED: { from: "administration", to: "administration" },
  COURIER_ASSIGNED: { from: "administration", to: "courier" },
  COURIER_REASSIGNED: { from: "courier", to: "courier" },
  COURIER_ACCEPTED: { from: "administration", to: "courier" },
  COURIER_DECLINED: { from: "courier", to: "administration" },
  DEPOSIT_STARTED: { from: "courier", to: "courier" },
  DEPOSIT_FAILED: { from: "courier", to: "administration" },
  INVOICE_DEPOSITED: { from: "courier", to: "courier" },
  PROOF_UPLOADED: { from: "courier", to: "courier" },
  PROOF_SUBMITTED: { from: "courier", to: "administration" },
  PROOF_ACCEPTED: { from: "administration", to: "administration" },
  PROOF_REJECTED: { from: "administration", to: "courier" },
  HANDED_TO_COLLECTIONS: { from: "administration", to: "collections" },
  CANCELLED: { from: "administration", to: "administration" },
};

/** Events that MUST carry a reason. Recorded, bounded, never a free-form essay. */
export const REASON_REQUIRED: CustodyEvent[] = [
  "COURIER_DECLINED",
  "DEPOSIT_FAILED",
  "PROOF_REJECTED",
  "COURIER_REASSIGNED",
];

/** Events that MUST carry an evidence document. */
export const EVIDENCE_REQUIRED: CustodyEvent[] = ["PROOF_UPLOADED", "PROOF_SUBMITTED"];

export const MAX_REASON = 500;

export type CustodyEventInput = {
  event: CustodyEvent;
  fromStatus: DepositStatus | null;
  toStatus: DepositStatus;
  actorId: string;
  actorRoleCode: string | null;
  reason?: string | null;
  evidenceDocumentId?: string | null;
  handoffId?: string | null;
};

export type CustodyValidation = { ok: true } | { ok: false; error: string };

/**
 * A custody event is only well-formed when it carries everything the chain needs.
 * This is what stops a transition being recorded without an actor, a reason, or
 * the evidence it claims.
 */
export function validateCustodyEvent(input: CustodyEventInput): CustodyValidation {
  if (!input.actorId) return { ok: false, error: "custody_actor_required" };

  if (REASON_REQUIRED.includes(input.event)) {
    const r = (input.reason ?? "").trim();
    if (r.length === 0) return { ok: false, error: "custody_reason_required" };
  }

  if (EVIDENCE_REQUIRED.includes(input.event) && !input.evidenceDocumentId) {
    return { ok: false, error: "custody_evidence_required" };
  }

  return { ok: true };
}

export function sanitizeReason(reason: string | null | undefined): string | null {
  const r = (reason ?? "").trim();
  return r.length === 0 ? null : r.slice(0, MAX_REASON);
}

export type CustodyEntry = {
  id: string;
  event: CustodyEvent;
  labelFr: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  actorRoleCode: string | null;
  fromDepartment: string | null;
  toDepartment: string | null;
  reason: string | null;
  evidenceDocumentId: string | null;
  occurredAt: string;
};

/**
 * Who holds the package right now — read from the LAST custody event, not from
 * the status. The brief's rule: never infer custody from the current status alone.
 */
export function currentCustodian(chain: CustodyEntry[]): CustodyDept | null {
  if (chain.length === 0) return null;
  const last = chain[chain.length - 1];
  return (last.toDepartment as CustodyDept | null) ?? null;
}

/** Every transition carries actor + time + from + to. Used as a completeness check. */
export function chainIsComplete(chain: CustodyEntry[]): boolean {
  return chain.every(
    (e) => !!e.actorId && !!e.occurredAt && !!e.toStatus && !!e.toDepartment && !!e.event,
  );
}

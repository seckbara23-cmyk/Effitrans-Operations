/**
 * Assignment & queue vocabulary (Phase WES-3A) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Split out for the same reason `seat.ts` was: the modules that USE these lists
 * are server-only (`queue.ts` reads the database, `actions.ts` is a server
 * action), but the lists themselves are plain data that a client component and
 * a test both need. Importing them from a server module drags React's `cache`
 * into every consumer.
 *
 * These are also the two places where the UI and the database must agree
 * exactly, so having one definition each is not merely tidy — a drifted reason
 * code is rejected by a CHECK constraint at the end of a user's workflow.
 */

// ---------------------------------------------------------------------------
// Assignment reason codes — mirrored by the SQL CHECK on assignment_event.
// ---------------------------------------------------------------------------
export const ASSIGNMENT_REASON_CODES = [
  "INITIAL",
  "REASSIGNMENT",
  "SUPERVISOR_INTERVENTION",
  "WORKLOAD_BALANCING",
  "ABSENCE",
  "ESCALATION",
  "CORRECTION",
  "UNASSIGNMENT",
  "GOVERNANCE",
] as const;
export type AssignmentReasonCode = (typeof ASSIGNMENT_REASON_CODES)[number];

export function isAssignmentReasonCode(v: string): v is AssignmentReasonCode {
  return (ASSIGNMENT_REASON_CODES as readonly string[]).includes(v);
}

/**
 * Codes that oblige the actor to explain themselves in free text.
 * Enforced in three places on purpose — the UI disables the button, the server
 * action refuses, and a database trigger raises. A missing reason on a
 * supervisor override is exactly the thing nobody can reconstruct afterwards.
 */
export const REASON_REQUIRED_CODES: readonly AssignmentReasonCode[] = [
  "SUPERVISOR_INTERVENTION",
  "GOVERNANCE",
];

export function reasonRequired(code: string): boolean {
  return (REASON_REQUIRED_CODES as readonly string[]).includes(code);
}

/** Codes an operator may pick when reassigning. INITIAL and UNASSIGNMENT are
 *  derived from the operation, never chosen; GOVERNANCE is not an operational
 *  reassignment reason and is reserved for platform administration. */
export const SELECTABLE_REASON_CODES: readonly {
  value: AssignmentReasonCode;
  labelFr: string;
}[] = [
  { value: "REASSIGNMENT", labelFr: "Réaffectation" },
  { value: "WORKLOAD_BALANCING", labelFr: "Équilibrage de charge" },
  { value: "ABSENCE", labelFr: "Absence" },
  { value: "ESCALATION", labelFr: "Escalade" },
  { value: "CORRECTION", labelFr: "Correction" },
  { value: "SUPERVISOR_INTERVENTION", labelFr: "Intervention de l'encadrement" },
];

export const ASSIGNMENT_REASON_LABELS_FR: Readonly<Record<AssignmentReasonCode, string>> = {
  INITIAL: "Affectation initiale",
  REASSIGNMENT: "Réaffectation",
  SUPERVISOR_INTERVENTION: "Intervention de l'encadrement",
  WORKLOAD_BALANCING: "Équilibrage de charge",
  ABSENCE: "Absence",
  ESCALATION: "Escalade",
  CORRECTION: "Correction",
  UNASSIGNMENT: "Retrait d'affectation",
  GOVERNANCE: "Décision d'administration",
};

// ---------------------------------------------------------------------------
// Department queue categories (WES-3H)
// ---------------------------------------------------------------------------

/** The six categories WES-3H requires. Order is the display order. */
export const QUEUE_CATEGORIES = [
  "unassigned",
  "mine",
  "colleague",
  "blocked",
  "awaiting_reception",
  "recently_completed",
] as const;
export type QueueCategory = (typeof QUEUE_CATEGORIES)[number];

export const QUEUE_CATEGORY_LABELS_FR: Readonly<Record<QueueCategory, string>> = {
  unassigned: "Non assigné",
  mine: "Assigné à moi",
  colleague: "Assigné à un collègue",
  blocked: "Bloqué",
  awaiting_reception: "En attente de réception",
  recently_completed: "Terminé récemment",
};

export function isQueueCategory(v: string | undefined): v is QueueCategory {
  return !!v && (QUEUE_CATEGORIES as readonly string[]).includes(v);
}

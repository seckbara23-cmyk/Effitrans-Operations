/**
 * Official department queue registry (Phase 5.0C). PURE.
 * ---------------------------------------------------------------------------
 * The 15 official queues. Their STEPS are NOT listed here — they are DERIVED from
 * the Phase 5.0A registry via each step's `department`, so there is exactly one
 * mapping of step -> department in the codebase and it cannot drift.
 *
 * What a queue definition adds on top of the registry is only what the registry
 * does not know: the French queue label, which tenant ROLES staff it, the
 * permission needed to open it, which actions it offers, and whether its work
 * arrives by an explicit handoff that must be RECEIVED before it can start.
 *
 * No queue table exists and none should: a queue is a filtered view over
 * process_step_execution. Queue state is never persisted.
 */
import { stepsForDepartment } from "../effitrans-process";
import type { ProcessDepartment, ProcessRole } from "../types";

/** Everything a queue row can offer. Each maps to a Phase 5.0B engine action. */
export type QueueAction =
  | "receive_handoff"
  | "reject_handoff"
  | "assign"
  | "start"
  | "submit"
  | "approve"
  | "reject"
  | "send_handoff"
  | "open_dossier"
  | "view_process";

export type QueueDef = {
  /** Stable key. Also the route segment: /queues/<key>. */
  key: ProcessDepartment;
  labelFr: string;
  description: string;
  /** Tenant role codes that staff this queue (used for "awaiting my role"). */
  roles: string[];
  /** Official role the registry assigns to this queue's steps. */
  officialRole: ProcessRole;
  /** Permission required to OPEN the queue. Server re-checks; nav is cosmetic. */
  permission: string;
  /** Work arrives by handoff and must be explicitly RECEIVED before it can start. */
  requiresReception: boolean;
  actions: QueueAction[];
};

const BASE: QueueAction[] = ["open_dossier", "view_process"];
const WORK: QueueAction[] = ["assign", "start", "submit", "send_handoff", ...BASE];
const RECEIVING: QueueAction[] = ["receive_handoff", "reject_handoff", ...WORK];
const REVIEWING: QueueAction[] = ["approve", "reject", ...BASE];

export const QUEUES: QueueDef[] = [
  {
    key: "cotation",
    labelFr: "Cotation",
    description: "Devis à préparer, envoyer et faire valider (clients sans contrat).",
    roles: ["QUOTATION_MANAGER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "COTATION_OFFICER",
    permission: "process:read",
    requiresReception: false,
    actions: WORK,
  },
  {
    key: "operations",
    labelFr: "Intake opérations",
    description: "Dossiers acceptés à affecter à un Account Manager.",
    roles: ["OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "OPERATIONS_MANAGER",
    permission: "process:read",
    requiresReception: false,
    actions: WORK,
  },
  {
    key: "account_management",
    labelFr: "Account Manager",
    description: "Ouverture, préparation, préparation transport parallèle, suivi livraison et complétude.",
    roles: ["ACCOUNT_MANAGER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "ACCOUNT_MANAGER",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
  {
    key: "coordination",
    labelFr: "Coordination",
    description: "Réceptions, transmissions, suivi douane et contrôle de complétude.",
    roles: ["COORDINATOR", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "COORDINATOR",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
  {
    key: "transit",
    labelFr: "Chef de Transit",
    description: "Affectation des déclarants et validation des dossiers douane (contrôle indépendant).",
    roles: ["CHIEF_OF_TRANSIT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "CHIEF_TRANSIT",
    permission: "process:read",
    requiresReception: true,
    actions: [...RECEIVING, "approve", "reject"],
  },
  {
    key: "customs_declaration",
    labelFr: "Déclarant",
    description: "Préparation du dossier de dédouanement et introduction des documents GAINDE.",
    roles: ["CUSTOMS_DECLARANT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "CUSTOMS_DECLARANT",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
  {
    key: "finance_customs",
    labelFr: "Finance douane",
    description: "Enregistrement manuel de la déclaration dans GAINDE (référence + date + preuve).",
    roles: ["CUSTOMS_FINANCE_OFFICER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "CUSTOMS_FINANCE_OFFICER",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
  {
    key: "customs_field",
    labelFr: "Terrain douane",
    description: "Suivi du circuit douane, obtention du Bon à Enlever et formalités de sortie.",
    roles: ["CUSTOMS_FIELD_AGENT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "CUSTOMS_FIELD_AGENT",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
  {
    key: "transport",
    labelFr: "Transport",
    description: "Affectation véhicule/chauffeur et remise du BL signé au Coordinateur.",
    roles: ["TRANSPORT_OFFICER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "TRANSPORT_OFFICER",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
  {
    key: "pickup",
    labelFr: "Enlèvement",
    description: "Missions d'enlèvement dont la porte de convergence est satisfaite.",
    roles: ["PICKUP_AGENT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "PICKUP_AGENT",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
  {
    key: "billing",
    labelFr: "Facturation",
    description: "Établissement de la facture et envoi (MAKER — ne valide jamais sa propre facture).",
    roles: ["BILLING_OFFICER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "BILLING_OFFICER",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
  {
    key: "finance",
    labelFr: "Validation Finance",
    description: "Contrôle indépendant des factures (CHECKER — identité du rédacteur affichée).",
    roles: ["FINANCE_OFFICER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "FINANCE_OFFICER",
    permission: "process:read",
    requiresReception: false,
    actions: REVIEWING,
  },
  {
    key: "administration",
    labelFr: "Administration",
    description: "Préparation du dépôt physique, affectation coursier, archivage, remise au recouvrement.",
    roles: ["ADMINISTRATIVE_OFFICER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "ADMINISTRATIVE_OFFICER",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
  {
    key: "courier",
    labelFr: "Courses",
    description: "Dépôt physique de la facture chez le client et preuve de dépôt.",
    roles: ["COURIER", "SYSTEM_ADMIN"],
    officialRole: "COURIER",
    permission: "process:read",
    requiresReception: true,
    // A courier NEVER mutates a financial status — no approve/reject here.
    actions: ["receive_handoff", "start", "submit", ...BASE],
  },
  {
    key: "collections",
    labelFr: "Recouvrement",
    description: "Échéances, relances et clôture APRÈS paiement intégral.",
    roles: ["COLLECTIONS_OFFICER", "FINANCE_OFFICER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    officialRole: "COLLECTIONS_OFFICER",
    permission: "process:read",
    requiresReception: true,
    actions: RECEIVING,
  },
];

export const QUEUE_KEYS = QUEUES.map((q) => q.key);

const BY_KEY = new Map<string, QueueDef>(QUEUES.map((q) => [q.key, q]));

export function getQueue(key: string): QueueDef | null {
  return BY_KEY.get(key) ?? null;
}

export function isQueueKey(v: string): v is ProcessDepartment {
  return BY_KEY.has(v);
}

/**
 * The official step keys this queue owns — DERIVED from the 5.0A registry, never
 * hardcoded. Memoized: the registry is immutable, so this is computed once.
 */
const STEPS_CACHE = new Map<string, string[]>();

export function queueStepKeys(key: ProcessDepartment): string[] {
  const cached = STEPS_CACHE.get(key);
  if (cached) return cached;
  const keys = stepsForDepartment(key).map((s) => s.key);
  STEPS_CACHE.set(key, keys);
  return keys;
}

/** Which queue owns a given official step. Exactly one, always. */
const QUEUE_BY_STEP = new Map<string, ProcessDepartment>();
for (const q of QUEUES) {
  for (const stepKey of queueStepKeys(q.key)) QUEUE_BY_STEP.set(stepKey, q.key);
}

export function queueForStep(stepKey: string): ProcessDepartment | null {
  return QUEUE_BY_STEP.get(stepKey) ?? null;
}

/** Queues a user may see, given their tenant roles and permissions. */
export function visibleQueues(roleCodes: string[], permissions: string[]): QueueDef[] {
  if (!permissions.includes("process:read")) return [];
  const roles = new Set(roleCodes);
  return QUEUES.filter((q) => q.roles.some((r) => roles.has(r)));
}

/**
 * Business event taxonomy (Phase WES-9A) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * ADR-WES-014: ONE canonical cross-domain operational timeline, populated from
 * successful COMMITTED domain facts. Domain ledgers stay authoritative for their
 * own detail; this is the timeline and the integration stream. It never
 * authorizes an action and never replaces the process engine.
 *
 * A CLOSED registry. Every type declares:
 *   * the domain it belongs to,
 *   * its current event VERSION (consumers dispatch on type + version),
 *   * the metadata keys it is allowed to carry (WES-9C allow-list),
 *   * HOW it is emitted — which is also a statement about how much it can be
 *     trusted:
 *       "trigger"  emitted by a database trigger in the SAME transaction as the
 *                  domain write. Cannot be missing when the fact exists.
 *       "rpc"      emitted inside a security-definer RPC that also performs the
 *                  domain write. Same guarantee.
 *       "reserved" the FEATURE exists but its write path is not yet
 *                  transactionally safe. NOTHING emits it today — declaring it
 *                  fixes the vocabulary so a later phase adds emission, not a
 *                  new name. A reserved type is never written by WES-9.
 *
 * Types for features that DO NOT EXIST YET are deliberately absent: internal
 * document generation (WES-4), transport order generation and mission events
 * (WES-6), assignment history (WES-3). Inventing their names now would be
 * manufacturing vocabulary for behaviour nobody has built.
 */

export const EVENT_DOMAINS = [
  "dossier",
  "document",
  "customs",
  "transport",
  "task",
  "handoff",
  "finance",
  "policy",
  "ledger",
] as const;
export type EventDomain = (typeof EVENT_DOMAINS)[number];

export type EventEmission = "trigger" | "rpc" | "reserved";

export type EventTypeDef = {
  type: string;
  domain: EventDomain;
  /** Bumped when the metadata SHAPE changes incompatibly. */
  version: number;
  emission: EventEmission;
  /** Metadata keys this type may carry. Anything else is rejected (WES-9C). */
  metadataKeys: readonly string[];
  /** Safe to surface in the customer portal feed (WES-9K allow-list). */
  clientSafe: boolean;
  labelFr: string;
};

/** Keys shared by the status-transition events. */
const TRANSITION = ["previous_status", "new_status"] as const;

export const EVENT_TYPES: readonly EventTypeDef[] = [
  // ------------------------------------------------------------------ dossier
  { type: "DOSSIER_OPENED", domain: "dossier", version: 1, emission: "trigger", metadataKeys: ["file_number", "file_type"], clientSafe: true, labelFr: "Dossier ouvert" },
  { type: "DOSSIER_STATUS_CHANGED", domain: "dossier", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: false, labelFr: "Statut du dossier modifié" },
  { type: "DOSSIER_CLOSED", domain: "dossier", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: true, labelFr: "Dossier clôturé" },
  { type: "ADMIN_OVERRIDE_EXECUTED", domain: "dossier", version: 1, emission: "reserved", metadataKeys: ["action"], clientSafe: false, labelFr: "Dérogation administrateur" },
  { type: "WORKFLOW_REVERSED", domain: "dossier", version: 1, emission: "reserved", metadataKeys: ["from_stage", "to_stage"], clientSafe: false, labelFr: "Retour en arrière du circuit" },

  // ----------------------------------------------------------------- document
  { type: "DOCUMENT_UPLOADED", domain: "document", version: 1, emission: "trigger", metadataKeys: ["type_code"], clientSafe: true, labelFr: "Document reçu" },
  { type: "DOCUMENT_VERIFIED", domain: "document", version: 1, emission: "trigger", metadataKeys: ["type_code", ...TRANSITION], clientSafe: true, labelFr: "Document vérifié" },
  { type: "DOCUMENT_REJECTED", domain: "document", version: 1, emission: "trigger", metadataKeys: ["type_code", ...TRANSITION], clientSafe: false, labelFr: "Document rejeté" },
  { type: "DOCUMENT_SHARED_WITH_CLIENT", domain: "document", version: 1, emission: "reserved", metadataKeys: ["type_code"], clientSafe: true, labelFr: "Document partagé" },

  // ------------------------------------------------------------------- customs
  { type: "CUSTOMS_RECORD_CREATED", domain: "customs", version: 1, emission: "trigger", metadataKeys: ["required"], clientSafe: false, labelFr: "Dossier douane ouvert" },
  { type: "CUSTOMS_STATUS_CHANGED", domain: "customs", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: false, labelFr: "Statut douane modifié" },
  { type: "CUSTOMS_DECLARED", domain: "customs", version: 1, emission: "trigger", metadataKeys: [...TRANSITION, "reference"], clientSafe: true, labelFr: "Déclaration déposée" },
  { type: "BAE_RECORDED", domain: "customs", version: 1, emission: "trigger", metadataKeys: ["reference"], clientSafe: false, labelFr: "BAE enregistré" },
  { type: "CUSTOMS_RELEASE_COMPLETED", domain: "customs", version: 1, emission: "trigger", metadataKeys: [...TRANSITION, "reference"], clientSafe: true, labelFr: "Mainlevée obtenue" },

  // ----------------------------------------------------------------- transport
  { type: "TRANSPORT_PLANNING_CREATED", domain: "transport", version: 1, emission: "trigger", metadataKeys: [], clientSafe: false, labelFr: "Transport initialisé" },
  { type: "TRANSPORT_STATUS_CHANGED", domain: "transport", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: false, labelFr: "Statut transport modifié" },
  { type: "TRANSPORT_PLANNED", domain: "transport", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: true, labelFr: "Transport planifié" },
  // No metadata: the only thing the row records about a driver is `driver_name`
  // / `driver_phone`, which are personal data and must never be copied into an
  // immutable ledger. The event states that an assignment happened.
  { type: "DRIVER_ASSIGNED", domain: "transport", version: 1, emission: "trigger", metadataKeys: [], clientSafe: false, labelFr: "Chauffeur affecté" },
  { type: "DRIVER_UNASSIGNED", domain: "transport", version: 1, emission: "trigger", metadataKeys: [], clientSafe: false, labelFr: "Chauffeur retiré" },
  { type: "PICKUP_CONFIRMED", domain: "transport", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: true, labelFr: "Enlèvement confirmé" },
  { type: "TRANSPORT_STARTED", domain: "transport", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: true, labelFr: "Transport démarré" },
  { type: "DELIVERY_COMPLETED", domain: "transport", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: true, labelFr: "Livraison effectuée" },
  { type: "POD_RECEIVED", domain: "transport", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: true, labelFr: "Preuve de livraison reçue" },

  // --------------------------------------------------------------------- task
  { type: "TASK_CREATED", domain: "task", version: 1, emission: "trigger", metadataKeys: ["priority"], clientSafe: false, labelFr: "Tâche créée" },
  // actor is NULL by design: `task` records assigned_to and created_by but not
  // who marked it done. Asserting the assignee did it would be an inference.
  // WES-3 (assignment history) is where that actor becomes knowable.
  { type: "TASK_COMPLETED", domain: "task", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: false, labelFr: "Tâche terminée" },
  { type: "TASK_CANCELLED", domain: "task", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: false, labelFr: "Tâche annulée" },

  // ------------------------------------------------------------------ handoff
  { type: "HANDOFF_SENT", domain: "handoff", version: 1, emission: "reserved", metadataKeys: ["from_step", "to_step"], clientSafe: false, labelFr: "Transfert envoyé" },
  { type: "HANDOFF_RECEIVED", domain: "handoff", version: 1, emission: "reserved", metadataKeys: ["from_step", "to_step"], clientSafe: false, labelFr: "Transfert reçu" },

  // ------------------------------------------------------------------ finance
  { type: "INVOICE_ISSUED", domain: "finance", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: true, labelFr: "Facture émise" },
  { type: "PAYMENT_RECORDED", domain: "finance", version: 1, emission: "trigger", metadataKeys: ["method"], clientSafe: true, labelFr: "Paiement enregistré" },
  { type: "EXPENSE_AUTHORIZED", domain: "finance", version: 1, emission: "reserved", metadataKeys: [...TRANSITION], clientSafe: false, labelFr: "Dépense autorisée" },

  // ------------------------------------------------------------------- policy
  { type: "POLICY_ACTIVATED", domain: "policy", version: 1, emission: "rpc", metadataKeys: ["scope", "version"], clientSafe: false, labelFr: "Politique activée" },
  { type: "POLICY_RETIRED", domain: "policy", version: 1, emission: "rpc", metadataKeys: ["scope", "version"], clientSafe: false, labelFr: "Politique retirée" },
  // Reserved, not emitted: WES-7 pins a policy at process-instance creation but
  // nothing creates instances through that path yet, so there is no fact to
  // record. Emission lands with the phase that starts pinning for real.
  { type: "DOSSIER_POLICY_PINNED", domain: "policy", version: 1, emission: "reserved", metadataKeys: ["provenance"], clientSafe: false, labelFr: "Politique rattachée au dossier" },

  // ------------------------------------------------------------------- ledger
  {
    type: "HISTORICAL_EVENTS_NOT_BACKFILLED",
    domain: "ledger",
    version: 1,
    emission: "reserved",
    metadataKeys: ["ledger_started_at"],
    clientSafe: false,
    labelFr: "Historique antérieur non repris",
  },
] as const;

const BY_TYPE = new Map(EVENT_TYPES.map((e) => [e.type, e]));

export function getEventType(type: string): EventTypeDef | null {
  return BY_TYPE.get(type) ?? null;
}

export function isKnownEventType(type: string): boolean {
  return BY_TYPE.has(type);
}

/** Types actually written today — trigger- or RPC-emitted, never "reserved". */
export function emittedEventTypes(): EventTypeDef[] {
  return EVENT_TYPES.filter((e) => e.emission !== "reserved");
}

/** The customer-safe allow-list. An explicit projection, never a filter over rows. */
export function clientSafeEventTypes(): EventTypeDef[] {
  return EVENT_TYPES.filter((e) => e.clientSafe);
}

export function isClientSafeEvent(type: string): boolean {
  return getEventType(type)?.clientSafe === true;
}

/** Source subsystems permitted in the envelope. */
export const EVENT_SOURCES = [
  "db_trigger",
  "policy_rpc",
  "app_action",
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export function isEventSource(v: string): v is EventSource {
  return (EVENT_SOURCES as readonly string[]).includes(v);
}

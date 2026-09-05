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
  // WES-5 — official process-engine reconciliation.
  "process",
  // EC-2 — inbound customer correspondence joins the operational timeline.
  // The DOSSIER is the subject when correspondence is attached to one, which is
  // what gives a shipment its communication dimension (Digital LOS).
  "communication",
  // EC-3B — the commercial offer that precedes the dossier.
  "commercial",
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

/**
 * Keys shared by the WES-3 assignment events. Note what is ABSENT: `reason`.
 * The structured code travels; the explanation stays in `assignment_event`,
 * reachable through `assignment_event_id`.
 */
const ASSIGNMENT_KEYS = ["reason_code", "assignment_event_id", "workflow_step_key"] as const;

export const EVENT_TYPES: readonly EventTypeDef[] = [
  // ------------------------------------------------------------------ dossier
  { type: "DOSSIER_OPENED", domain: "dossier", version: 1, emission: "trigger", metadataKeys: ["file_number", "file_type"], clientSafe: true, labelFr: "Dossier ouvert" },
  { type: "DOSSIER_STATUS_CHANGED", domain: "dossier", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: false, labelFr: "Statut du dossier modifié" },
  { type: "DOSSIER_CLOSED", domain: "dossier", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: true, labelFr: "Dossier clôturé" },
  { type: "ADMIN_OVERRIDE_EXECUTED", domain: "dossier", version: 1, emission: "reserved", metadataKeys: ["action"], clientSafe: false, labelFr: "Dérogation administrateur" },
  { type: "WORKFLOW_REVERSED", domain: "dossier", version: 1, emission: "reserved", metadataKeys: ["from_stage", "to_stage"], clientSafe: false, labelFr: "Retour en arrière du circuit" },

  // ----------------------------------------------------------------- document
  { type: "DOCUMENT_UPLOADED", domain: "document", version: 1, emission: "trigger", metadataKeys: ["type_code"], clientSafe: true, labelFr: "Document reçu" },
  { type: "DOCUMENT_VERIFIED", domain: "document", version: 1, emission: "rpc", metadataKeys: ["type_code", ...TRANSITION, "reason_code", "has_reason", "reason_reference_id", "is_override"], clientSafe: true, labelFr: "Document vérifié" },
  { type: "DOCUMENT_REJECTED", domain: "document", version: 1, emission: "rpc", metadataKeys: ["type_code", ...TRANSITION, "reason_code", "has_reason", "reason_reference_id", "is_override"], clientSafe: false, labelFr: "Document rejeté" },
  { type: "DOCUMENT_SHARED_WITH_CLIENT", domain: "document", version: 1, emission: "trigger", metadataKeys: ["type_code"], clientSafe: true, labelFr: "Document partagé" },
  // WES-4 review transitions, emitted by review_document (the trigger no
  // longer emits them — one owner per fact).
  { type: "DOCUMENT_VERIFICATION_REQUESTED", domain: "document", version: 1, emission: "rpc", metadataKeys: ["type_code", ...TRANSITION, "reason_code", "has_reason", "reason_reference_id", "is_override"], clientSafe: false, labelFr: "Vérification demandée" },
  { type: "DOCUMENT_SUPERSEDED", domain: "document", version: 1, emission: "rpc", metadataKeys: ["type_code", "reason_reference_id"], clientSafe: false, labelFr: "Document remplacé" },
  // WES-4G — now backed by a real generator, so it stops being reserved.
  { type: "INTERNAL_DOCUMENT_GENERATED", domain: "document", version: 1, emission: "rpc", metadataKeys: ["type_code", "artifact_code", "renderer_version", "artifact_version"], clientSafe: false, labelFr: "Document interne généré" },

  // ------------------------------------------------------------------- customs
  { type: "CUSTOMS_RECORD_CREATED", domain: "customs", version: 1, emission: "trigger", metadataKeys: ["required"], clientSafe: false, labelFr: "Dossier douane ouvert" },
  { type: "CUSTOMS_STATUS_CHANGED", domain: "customs", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: false, labelFr: "Statut douane modifié" },
  { type: "CUSTOMS_DECLARED", domain: "customs", version: 1, emission: "trigger", metadataKeys: [...TRANSITION, "reference"], clientSafe: true, labelFr: "Déclaration déposée" },
  { type: "BAE_RECORDED", domain: "customs", version: 1, emission: "trigger", metadataKeys: ["reference"], clientSafe: false, labelFr: "BAE enregistré" },
  // MAYA-P0.8-A (PG-1) — the Chef de Transit validation. Emitted ONLY by
  // record_customs_validation; the WES-9 customs trigger watches status and the
  // BAE reference, not the review columns, so there is one owner. Internal: an
  // internal control decision is not customer-facing. `maker_checked` records
  // that the separation was evaluated, never WHO the maker was — the ledger
  // states the fact, the record holds the identities.
  // MAYA-P1.1 — CEO step 8: Finance registers the declaration in GAINDE.
  // Emitted ONLY by record_gainde_registration. The reference travels, as it
  // does for BAE_RECORDED — a business reference the client may quote, not
  // personal data. `corrected` distinguishes a first registration from a
  // replacement. Internal: a customs reference is not customer-facing.
  { type: "GAINDE_REGISTRATION_RECORDED", domain: "customs", version: 1, emission: "rpc", metadataKeys: ["reference", "corrected"], clientSafe: false, labelFr: "Enregistrement GAINDE" },
  { type: "CUSTOMS_VALIDATED", domain: "customs", version: 1, emission: "rpc", metadataKeys: ["maker_checked"], clientSafe: false, labelFr: "Validation Chef de Transit" },
  { type: "CUSTOMS_CORRECTED", domain: "customs", version: 1, emission: "rpc", metadataKeys: ["correction_id", "fields", "displaced_validation_by"], clientSafe: false, labelFr: "Correction après validation" },
  { type: "CUSTOMS_REVALIDATED", domain: "customs", version: 1, emission: "rpc", metadataKeys: ["correction_id", "maker_checked"], clientSafe: false, labelFr: "Revalidation après correction" },
  // MAYA-P1.11 — CEO step 9. Emitted ONLY by record_customs_attachment. The
  // systems are business context (GAINDE/ORBUS), never personal data; `repeated`
  // marks the retry Effitrans described after a recevabilite rejection.
  { type: "CUSTOMS_ATTACHMENT_RECORDED", domain: "customs", version: 1, emission: "rpc", metadataKeys: ["systems", "repeated"], clientSafe: false, labelFr: "Rattachement des documents" },
  // MAYA-P0.7-A — Quality Control N°3. Emitted ONLY by
  // record_customs_receivability: the WES-9 customs trigger does not watch the
  // receivability columns, so there is exactly one owner of this fact and no
  // double emission is possible. The declarant's REASON TEXT is not carried —
  // only whether one was given — for the reason WES-9A kept assignment reasons
  // out of the ledger: free text belongs on the record, where it can be
  // corrected, not in an immutable append-only store. Internal: a receivability
  // refusal is an internal judgement and must not reach the customer portal.
  { type: "CUSTOMS_RECEIVABILITY_DECIDED", domain: "customs", version: 1, emission: "rpc", metadataKeys: [...TRANSITION, "has_reason"], clientSafe: false, labelFr: "Recevabilité prononcée" },
  // TRANSIT-CUSTODY-05 — the release is two acts. The field actor records the
  // mainlevée and the dossier waits; the Chef de Transit verifies independently
  // and only then may the release proceed. Emitted ONLY by their two RPCs, so
  // each fact has exactly one owner and no double emission is possible. The
  // Chef's reason text stays on the record (WES-9A): the ledger states that a
  // decision was taken and what it was. Internal — a refusal is an internal
  // judgement and must not reach the customer portal.
  { type: "CUSTOMS_BAE_RECORDED_PENDING_VERIFICATION", domain: "customs", version: 1, emission: "rpc", metadataKeys: ["previous_reference", "replaced", "after_rejection"], clientSafe: false, labelFr: "BAE enregistré — vérification du Chef de Transit requise" },
  { type: "CUSTOMS_RELEASE_APPROVED", domain: "customs", version: 1, emission: "rpc", metadataKeys: [...TRANSITION, "has_reason", "recorded_by"], clientSafe: false, labelFr: "Libération vers le Transport approuvée" },
  { type: "CUSTOMS_RELEASE_REJECTED", domain: "customs", version: 1, emission: "rpc", metadataKeys: [...TRANSITION, "has_reason", "recorded_by"], clientSafe: false, labelFr: "Libération vers le Transport refusée" },
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

  // --------------------------------------------------------- assignment WES-3
  // Emitted by the assign_* RPCs, which perform the assignment write, the
  // assignment_event append and this event in ONE transaction.
  //
  // `reason` is NEVER carried here. WES-9A / DEC-B75 ratified that unrestricted
  // free text must not reach the immutable ledger: the event carries the
  // STRUCTURED `reason_code` plus `assignment_event_id`, a safe reference into
  // the protected assignment ledger where the explanation actually lives.
  { type: "TASK_ASSIGNED", domain: "task", version: 1, emission: "rpc", metadataKeys: ASSIGNMENT_KEYS, clientSafe: false, labelFr: "Tâche affectée" },
  { type: "TASK_REASSIGNED", domain: "task", version: 1, emission: "rpc", metadataKeys: ASSIGNMENT_KEYS, clientSafe: false, labelFr: "Tâche réaffectée" },
  { type: "TASK_UNASSIGNED", domain: "task", version: 1, emission: "rpc", metadataKeys: ASSIGNMENT_KEYS, clientSafe: false, labelFr: "Affectation retirée" },
  { type: "STEP_ASSIGNED", domain: "task", version: 1, emission: "rpc", metadataKeys: ASSIGNMENT_KEYS, clientSafe: false, labelFr: "Étape affectée" },
  { type: "STEP_REASSIGNED", domain: "task", version: 1, emission: "rpc", metadataKeys: ASSIGNMENT_KEYS, clientSafe: false, labelFr: "Étape réaffectée" },
  { type: "OPERATIONAL_OWNER_ASSIGNED", domain: "dossier", version: 1, emission: "rpc", metadataKeys: ASSIGNMENT_KEYS, clientSafe: false, labelFr: "Responsable opérationnel désigné" },
  { type: "OPERATIONAL_OWNER_REASSIGNED", domain: "dossier", version: 1, emission: "rpc", metadataKeys: ASSIGNMENT_KEYS, clientSafe: false, labelFr: "Responsable opérationnel changé" },
  // TMS-1 — the Responsable client (Account Manager), assigned by the
  // Operations Manager (registry step 2), emitted by assign_commercial_owner.
  { type: "COMMERCIAL_OWNER_ASSIGNED", domain: "dossier", version: 1, emission: "rpc", metadataKeys: ASSIGNMENT_KEYS, clientSafe: false, labelFr: "Responsable client désigné" },
  { type: "COMMERCIAL_OWNER_REASSIGNED", domain: "dossier", version: 1, emission: "rpc", metadataKeys: ASSIGNMENT_KEYS, clientSafe: false, labelFr: "Responsable client remplacé" },

  // ------------------------------------------------------------------ handoff
  { type: "HANDOFF_SENT", domain: "handoff", version: 1, emission: "trigger", metadataKeys: ["from_step", "to_step"], clientSafe: false, labelFr: "Transfert envoyé" },
  { type: "HANDOFF_RECEIVED", domain: "handoff", version: 1, emission: "trigger", metadataKeys: ["from_step", "to_step"], clientSafe: false, labelFr: "Transfert reçu" },

  // ------------------------------------------------------------------ finance
  { type: "INVOICE_ISSUED", domain: "finance", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: true, labelFr: "Facture émise" },
  { type: "PAYMENT_RECORDED", domain: "finance", version: 1, emission: "trigger", metadataKeys: ["method"], clientSafe: true, labelFr: "Paiement enregistré" },
  { type: "EXPENSE_AUTHORIZED", domain: "finance", version: 1, emission: "trigger", metadataKeys: [...TRANSITION], clientSafe: false, labelFr: "Dépense autorisée" },

  // ------------------------------------------------------------------ process
  // WES-5 — emitted by reconcile_step_completion, atomically with the step
  // transition. reason_code carries the FACT CODE that proved the step
  // (CUSTOMS_RELEASED, POD_RECEIVED, ...); is_override marks legacy-
  // compatibility reconciliation. Conflicts are RETURNED by the service, not
  // emitted: an idempotent re-run would duplicate them without a dedup key,
  // and an unreliable event is worse than none (documented deferral).
  { type: "PROCESS_STEP_COMPLETED", domain: "process", version: 1, emission: "rpc", metadataKeys: ["workflow_step_key", "reason_code", "is_override"], clientSafe: false, labelFr: "Étape officielle réalisée" },
  { type: "EVIDENCE_CONSUMED", domain: "process", version: 1, emission: "rpc", metadataKeys: ["workflow_step_key", "artifact_version"], clientSafe: false, labelFr: "Preuve consommée par une étape" },

  // ------------------------------------------------------------ communication
  // EC-2. Metadata carries IDENTIFIERS AND CODES ONLY — never a subject, a
  // sender, a filename or a body. The discard COMMENT stays in ec_triage_item;
  // only its reason_code travels, exactly as WES-4 does for rejection reasons.
  //
  // CORRESPONDENCE_RECEIVED became a TRIGGER at UT-3B (migration 86,
  // emit_correspondence_received on ec_inbound_message). It was reserved at
  // EC-2 because capture is a multi-step application sequence; the trigger
  // resolved that by emitting inside the insert's own transaction. EMP-3 does
  // not touch it — the inbound emitter stays exactly as UT-3B left it.
  { type: "CORRESPONDENCE_RECEIVED", domain: "communication", version: 1, emission: "trigger", metadataKeys: ["triage_item_id", "message_id", "mailbox_id"], clientSafe: false, labelFr: "Correspondance reçue" },
  { type: "CORRESPONDENCE_ASSIGNED", domain: "communication", version: 1, emission: "rpc", metadataKeys: ["triage_item_id", "message_id"], clientSafe: false, labelFr: "Correspondance attribuée" },
  { type: "CORRESPONDENCE_REASSIGNED", domain: "communication", version: 1, emission: "rpc", metadataKeys: ["triage_item_id", "message_id"], clientSafe: false, labelFr: "Correspondance réattribuée" },
  // The one event whose subject is the DOSSIER — this is what places a customer
  // interaction on that shipment's timeline.
  { type: "CORRESPONDENCE_ATTACHED", domain: "communication", version: 1, emission: "rpc", metadataKeys: ["triage_item_id", "message_id"], clientSafe: false, labelFr: "Correspondance rattachée au dossier" },
  { type: "CORRESPONDENCE_QUOTATION_HANDOFF", domain: "communication", version: 1, emission: "rpc", metadataKeys: ["triage_item_id", "message_id"], clientSafe: false, labelFr: "Correspondance orientée vers une cotation" },
  { type: "CORRESPONDENCE_RESOLVED", domain: "communication", version: 1, emission: "rpc", metadataKeys: ["triage_item_id", "message_id", "outcome"], clientSafe: false, labelFr: "Correspondance traitée" },
  // ---------------------------------------------------------------- commercial
  // EC-3B. Identifiers and codes only — no amounts, no prose. WES-9C's deny-list
  // already blocks amount/price/currency/reason, and the quotation's money never
  // travels: the ledger points at the quotation, which stays authoritative.
  { type: "QUOTATION_CREATED", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "request_id"], clientSafe: false, labelFr: "Cotation créée" },
  { type: "QUOTATION_SUBMITTED", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "request_id"], clientSafe: false, labelFr: "Cotation soumise à validation" },
  { type: "QUOTATION_VALIDATED", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "request_id"], clientSafe: false, labelFr: "Cotation validée en interne" },
  { type: "QUOTATION_REJECTED", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "reason_code"], clientSafe: false, labelFr: "Cotation renvoyée au préparateur" },
  // The customer knows they received it, so this one is client-safe.
  { type: "QUOTATION_SENT", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "request_id"], clientSafe: true, labelFr: "Cotation envoyée au client" },
  { type: "QUOTATION_ACCEPTED", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "request_id", "acceptance_kind"], clientSafe: true, labelFr: "Cotation acceptée par le client" },
  { type: "QUOTATION_DECLINED", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "request_id"], clientSafe: false, labelFr: "Cotation refusée par le client" },
  { type: "QUOTATION_REVISED", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "supersedes_id", "request_id"], clientSafe: false, labelFr: "Cotation révisée (nouvelle version)" },
  { type: "QUOTATION_CANCELLED", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "request_id", "reason_code"], clientSafe: false, labelFr: "Cotation annulée" },
  // THE keystone: subject and dossier_id are the DOSSIER, so a shipment's
  // timeline begins with its commercial provenance.
  { type: "QUOTATION_CONVERTED_TO_DOSSIER", domain: "commercial", version: 1, emission: "rpc", metadataKeys: ["quotation_id", "request_id"], clientSafe: true, labelFr: "Dossier ouvert depuis la cotation" },

  { type: "CORRESPONDENCE_DISCARDED", domain: "communication", version: 1, emission: "rpc", metadataKeys: ["triage_item_id", "message_id", "reason_code"], clientSafe: false, labelFr: "Correspondance rejetée" },
  // EMP-3 — the ONE outbound event. It means exactly: a REAL provider accepted
  // this correspondence. It is not delivery (no bounce webhook exists, so
  // delivery is unprovable and DELIVERED/READ deliberately do not exist), it is
  // not a draft, and a rejected or stub-"accepted" send never produces it.
  // Emitted only by comm_record_send_accepted, in the same transaction as the
  // SENDING -> SENT transition, which is what makes it exactly-once.
  // clientSafe stays FALSE: customers see no correspondence through EMP-3.
  { type: "CORRESPONDENCE_SENT", domain: "communication", version: 1, emission: "rpc", metadataKeys: ["message_id", "mailbox_id", "thread_id", "kind", "provider"], clientSafe: false, labelFr: "Correspondance envoyée" },

  // ------------------------------------------------------------------- policy
  { type: "POLICY_ACTIVATED", domain: "policy", version: 1, emission: "rpc", metadataKeys: ["scope", "version"], clientSafe: false, labelFr: "Politique activée" },
  { type: "POLICY_RETIRED", domain: "policy", version: 1, emission: "rpc", metadataKeys: ["scope", "version"], clientSafe: false, labelFr: "Politique retirée" },
  // Reserved, not emitted: WES-7 pins a policy at process-instance creation but
  // nothing creates instances through that path yet, so there is no fact to
  // record. Emission lands with the phase that starts pinning for real.
  { type: "DOSSIER_POLICY_PINNED", domain: "policy", version: 1, emission: "trigger", metadataKeys: ["provenance"], clientSafe: false, labelFr: "Politique rattachée au dossier" },

  // ------------------------------------------------------------------- ledger
  {
    type: "HISTORICAL_EVENTS_NOT_BACKFILLED",
    domain: "ledger",
    version: 1,
    emission: "rpc",
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
  // WES-3: the assign_* RPCs, which write the assignment, its history row and
  // this event in one transaction.
  "assignment_rpc",
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export function isEventSource(v: string): v is EventSource {
  return (EVENT_SOURCES as readonly string[]).includes(v);
}

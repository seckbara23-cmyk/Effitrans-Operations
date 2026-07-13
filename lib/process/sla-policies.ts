/**
 * Official process SLA policy keys (Phase 5.0A) — PURE. NO VALUES INVENTED.
 * ---------------------------------------------------------------------------
 * Deliverable 13: create SLA policy KEYS and admin-configurable placeholders; do
 * not fabricate business SLA values. Every policy here is `unconfigured` until
 * Effitrans management supplies a number. An unconfigured policy must render as
 * "SLA non configuré" and must NEVER produce an overdue/late status.
 *
 * IMPORTANT — pre-existing values. lib/sla/config.ts already hardcodes four
 * department thresholds (documentation 48h/96h, customs 72h/144h, transport
 * 24h/72h, finance 7d/30d) that nobody ratified, and they already drive delay
 * flags in the Control Tower and risk scores in the Copilot. Phase 5.0A does NOT
 * change them — removing them would silently blind shipped features. They are
 * recorded below as `unratified` so the distinction stays visible:
 *
 *   unconfigured — no value at all. Render "SLA non configuré". Never overdue.
 *   unratified   — a value exists and is live, but management never approved it.
 *   ratified     — approved by Effitrans management. (None yet.)
 *
 * Phase 5.0E makes these admin-configurable and wires escalation routing.
 */

export type SlaPolicyState = "unconfigured" | "unratified" | "ratified";

export type SlaPolicy = {
  key: string;
  labelFr: string;
  state: SlaPolicyState;
  /** Hours. `null` whenever state is `unconfigured` — never fabricate a number. */
  warningHours: number | null;
  criticalHours: number | null;
  /** For `unratified` policies: where the live value comes from. */
  source?: string;
};

export const PROCESS_SLA_POLICIES: SlaPolicy[] = [
  { key: "quotation_response", labelFr: "Réponse à la cotation", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "operations_assignment", labelFr: "Affectation par les Opérations", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "dossier_opening", labelFr: "Ouverture du dossier", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "coordinator_reception", labelFr: "Réception par le Coordinateur", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "declarant_assignment", labelFr: "Affectation du Déclarant", state: "unconfigured", warningHours: null, criticalHours: null },
  {
    key: "customs_preparation",
    labelFr: "Préparation du dossier douane",
    state: "unratified",
    warningHours: 72,
    criticalHours: 144,
    source: "lib/sla/config.ts SLA_THRESHOLDS.customs — live, never approved by management",
  },
  { key: "chief_transit_validation", labelFr: "Validation Chef de Transit", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "gainde_registration", labelFr: "Enregistrement GAINDE", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "customs_document_submission", labelFr: "Introduction des documents GAINDE", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "customs_followup", labelFr: "Suivi douane", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "bae_followup", labelFr: "Obtention du BAE", state: "unconfigured", warningHours: null, criticalHours: null },
  {
    key: "transport_assignment",
    labelFr: "Affectation du transport",
    state: "unratified",
    warningHours: 24,
    criticalHours: 72,
    source: "lib/sla/config.ts SLA_THRESHOLDS.transport — live, never approved by management",
  },
  { key: "pickup", labelFr: "Enlèvement", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "delivery_followup", labelFr: "Suivi de livraison", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "pod_collection", labelFr: "Collecte du BL signé", state: "unconfigured", warningHours: null, criticalHours: null },
  {
    key: "completeness_review",
    labelFr: "Contrôle de complétude",
    state: "unratified",
    warningHours: 48,
    criticalHours: 96,
    source: "lib/sla/config.ts SLA_THRESHOLDS.documentation — live, never approved by management",
  },
  { key: "billing_draft", labelFr: "Établissement de la facture", state: "unconfigured", warningHours: null, criticalHours: null },
  {
    key: "invoice_validation",
    labelFr: "Validation de la facture",
    state: "unratified",
    warningHours: 168,
    criticalHours: 720,
    source: "lib/sla/config.ts SLA_THRESHOLDS.finance — live, never approved by management",
  },
  { key: "invoice_dispatch", labelFr: "Envoi de la facture", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "physical_deposit", labelFr: "Dépôt physique de la facture", state: "unconfigured", warningHours: null, criticalHours: null },
  { key: "collections_followup", labelFr: "Relance recouvrement", state: "unconfigured", warningHours: null, criticalHours: null },
];

export const SLA_POLICY_KEYS = PROCESS_SLA_POLICIES.map((p) => p.key);

const BY_KEY = new Map<string, SlaPolicy>(PROCESS_SLA_POLICIES.map((p) => [p.key, p]));

export function getSlaPolicy(key: string): SlaPolicy | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * An unconfigured policy can NEVER report an overdue/late status. This is the
 * guard that keeps Deliverable 13's rule true no matter what the UI does.
 */
export function slaIsEnforceable(key: string): boolean {
  const p = BY_KEY.get(key);
  return !!p && p.state !== "unconfigured" && p.warningHours !== null;
}

/** The label to render when a policy has no value. Never show a fabricated one. */
export const SLA_UNCONFIGURED_LABEL = "SLA non configuré";

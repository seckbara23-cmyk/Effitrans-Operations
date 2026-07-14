/**
 * Official document → document_type mapping (Phase 5.0A) — PURE.
 * ---------------------------------------------------------------------------
 * The document-gap matrix as data. The official process names 17 artefacts. The
 * catalog (public.document_type, 16 rows) covers 6 cleanly, 3 partially, and is
 * missing 8 outright. Two artefacts are correctly modelled as structured records
 * rather than uploads (the customs dossier and the final invoice).
 *
 * REUSE THE CATALOG. document_type already carries required_for[], conditional,
 * gates_customs and has_validity — the missing types slot in as DATA ROWS in
 * Phase 5.0D, not as schema changes. Do not build a second attachment system and
 * do not duplicate uploads.
 */

export type DocumentMappingStatus =
  /** An existing document_type serves this artefact as-is. */
  | "mapped"
  /** An existing type is close but semantically different — needs a new type or a split. */
  | "partial"
  /** No document type exists. */
  | "missing"
  /** Correctly modelled as a structured record, not an uploaded document. */
  | "structured";

export type DocumentMapping = {
  /** Stable official key, referenced by ProcessStep.requiredDocuments. */
  key: string;
  labelFr: string;
  /** Existing document_type.code, or `null`. */
  typeCode: string | null;
  status: DocumentMappingStatus;
  /** Official step keys that consume or produce this artefact. */
  steps: string[];
  note: string;
};

export const DOCUMENT_MAPPINGS: DocumentMapping[] = [
  {
    key: "QUOTATION",
    labelFr: "Cotation / Devis",
    typeCode: "QUOTATION",
    status: "mapped",
    steps: ["cotation"],
    note: "Listed in docs/document-catalog.md but never migrated. No quotation entity either.",
  },
  {
    key: "QUOTATION_APPROVAL",
    labelFr: "Validation client de la cotation",
    typeCode: "QUOTATION_APPROVAL",
    status: "mapped",
    steps: ["cotation"],
    note: "No customer-approval evidence of any kind. The lifecycle step `quote_approved` is cosmetic.",
  },
  {
    key: "TRANSPORT_REQUEST",
    labelFr: "Demande de transport",
    typeCode: "TRANSPORT_REQUEST",
    status: "mapped",
    steps: ["am_dossier_opening"],
    note: "TRANSPORT_ORDER is an ORDER to a subcontractor, not a REQUEST raised by the Account Manager. Semantically different — needs its own type.",
  },
  {
    key: "BORDEREAU_LIVRAISON",
    labelFr: "Bordereau de Livraison (non signé)",
    typeCode: "BORDEREAU_LIVRAISON",
    status: "mapped",
    steps: ["am_dossier_opening", "transport_docs_transmission"],
    note: "SPLIT IN PHASE 5.0D (20260714000001). Until then ONE type (DELIVERY_NOTE) served both the slip prepared at step 3 and the signed POD at steps 16-17. That was not merely untidy: it made the official pickup gate UNSATISFIABLE in real use, because the only type that could satisfy it was a POD that cannot exist before delivery. DELIVERY_NOTE now means the SIGNED POD only (the driver flow is untouched); this is the unsigned operational slip the pickup gate reads.",
  },
  {
    key: "VENDOR_INVOICE",
    labelFr: "Facture tierce payable pour le client",
    typeCode: "VENDOR_INVOICE",
    status: "mapped",
    steps: ["am_dossier_opening"],
    note: "No accounts-payable model at all. Finance is explicitly scoped 'no supplier bills'. COMMERCIAL_INVOICE is the customs-value invoice, not a vendor bill.",
  },
  {
    key: "SPENDING_AUTHORIZATION",
    labelFr: "Autorisation de dépense",
    typeCode: "SPENDING_AUTHORIZATION",
    status: "mapped",
    steps: ["am_dossier_opening"],
    note: "Zero occurrences repo-wide. Never customer-visible.",
  },
  {
    key: "CUSTOMS_DOSSIER",
    labelFr: "Dossier de dédouanement",
    typeCode: null,
    status: "structured",
    steps: ["customs_preparation", "transit_validation"],
    note: "Correctly modelled as the customs_record table (1:1 with operational_file), not as an uploaded document. Its constituent documents are gated by document_type.gates_customs.",
  },
  {
    key: "GAINDE_DECLARATION_REFERENCE",
    labelFr: "Référence + preuve d'enregistrement GAINDE",
    typeCode: "GAINDE_REGISTRATION_EVIDENCE",
    status: "mapped",
    steps: ["gainde_registration"],
    note: "Two halves, both now real. The REFERENCE stays where it belongs, as customs_record.external_ref (manual, DEC-B01 — still no GAINDE API). The RECEIPT is now an uploadable GAINDE_REGISTRATION_EVIDENCE document (Phase 5.0D), so step 9's milestone has actor, date AND evidence instead of a bare text field.",
  },
  {
    key: "GAINDE_SUBMISSION_EVIDENCE",
    labelFr: "Preuve d'introduction des documents dans GAINDE",
    typeCode: "GAINDE_SUBMISSION_EVIDENCE",
    status: "mapped",
    steps: ["gainde_document_submission"],
    note: "No submission evidence of any kind.",
  },
  {
    key: "BON_A_ENLEVER",
    labelFr: "Bon à Enlever (BAE)",
    typeCode: "BON_A_ENLEVER",
    status: "mapped",
    steps: ["customs_field_clearance"],
    note: "customs_record.bae_reference exists and canRelease() requires it — but the BAE is a REFERENCE STRING, not an uploadable document. Promote it to a document type so the physical BAE can be attached as evidence.",
  },
  {
    key: "BON_A_DELIVRER",
    labelFr: "Bon à Délivrer (BAD)",
    typeCode: "BON_A_DELIVRER",
    status: "mapped",
    steps: ["bon_a_delivrer"],
    note: "ADDED IN PHASE 5.0B (20260713000002). A hard prerequisite of the pickup join gate — without a document type to hold it the gate could never open, only block.",
  },
  {
    key: "PRE_GATE_AUTHORIZATION",
    labelFr: "Autorisation Pre-Gate",
    typeCode: "PRE_GATE_AUTHORIZATION",
    status: "mapped",
    steps: ["pre_gate", "transport_docs_transmission"],
    note: "ADDED IN PHASE 5.0B (20260713000002). A hard prerequisite of the pickup join gate.",
  },
  {
    key: "SIGNED_DELIVERY_NOTE",
    labelFr: "Bordereau de Livraison signé (POD)",
    typeCode: "DELIVERY_NOTE",
    status: "mapped",
    steps: ["am_delivery_followup", "transport_pod_handoff"],
    note: "DELIVERY_NOTE = the SIGNED POD, and after the Phase 5.0D split it means ONLY that. POD_RECEIVED is gated on an APPROVED DELIVERY_NOTE and the driver flow captures DRIVER_SIGNATURE — both unchanged by the split, deliberately: no data migration, no alias, no rewrite of existing rows.",
  },
  {
    key: "RECEIPT",
    labelFr: "Reçu",
    typeCode: "PAYMENT_RECEIPT",
    status: "mapped",
    steps: ["coordinator_completeness"],
    note: "PAYMENT_RECEIPT covers this.",
  },
  {
    key: "PAYMENT_PROOF",
    labelFr: "Preuve de paiement",
    typeCode: "PAYMENT_RECEIPT",
    status: "mapped",
    steps: ["coordinator_completeness"],
    note: "Reuses PAYMENT_RECEIPT — already the type used by the portal's payment-proof upload.",
  },
  {
    key: "FINAL_INVOICE",
    labelFr: "Facture définitive",
    typeCode: null,
    status: "structured",
    steps: ["billing_dispatch", "administration_deposit_prep"],
    note: "Correctly modelled as the invoice entity, not an uploaded document.",
  },
  {
    key: "PROOF_OF_DEPOSIT",
    labelFr: "Preuve de dépôt physique",
    typeCode: "PROOF_OF_DEPOSIT",
    status: "mapped",
    steps: ["courier_deposit", "administration_proof_handoff"],
    note: "Zero occurrences repo-wide. Must record recipient and date, and must NOT mutate any financial status.",
  },
];

/**
 * Document types still missing from the catalog: NONE.
 *
 * Phase 5.0B shipped BON_A_DELIVRER + PRE_GATE_AUTHORIZATION (the pickup gate
 * needed them). Phase 5.0D (20260714000001) shipped the remaining nine, including
 * the BORDEREAU_LIVRAISON split. Every artefact the official 26-step process names
 * can now be captured. Kept as an empty array (not deleted) so the invariant
 * "the registry's document surface is fully backed by the catalog" stays asserted.
 */
export const MISSING_DOCUMENT_TYPES: string[] = [];

const BY_KEY = new Map<string, DocumentMapping>(DOCUMENT_MAPPINGS.map((d) => [d.key, d]));

export function mapDocument(key: string): DocumentMapping {
  const d = BY_KEY.get(key);
  if (!d) throw new Error(`unmapped official document: ${key}`);
  return d;
}

/** True when the artefact can actually be captured today (upload or record). */
export function documentIsCapturable(key: string): boolean {
  const s = mapDocument(key).status;
  return s === "mapped" || s === "structured";
}

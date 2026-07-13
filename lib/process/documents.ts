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
    typeCode: null,
    status: "missing",
    steps: ["cotation"],
    note: "Listed in docs/document-catalog.md but never migrated. No quotation entity either.",
  },
  {
    key: "QUOTATION_APPROVAL",
    labelFr: "Validation client de la cotation",
    typeCode: null,
    status: "missing",
    steps: ["cotation"],
    note: "No customer-approval evidence of any kind. The lifecycle step `quote_approved` is cosmetic.",
  },
  {
    key: "TRANSPORT_REQUEST",
    labelFr: "Demande de transport",
    typeCode: "TRANSPORT_ORDER",
    status: "partial",
    steps: ["am_dossier_opening"],
    note: "TRANSPORT_ORDER is an ORDER to a subcontractor, not a REQUEST raised by the Account Manager. Semantically different — needs its own type.",
  },
  {
    key: "BORDEREAU_LIVRAISON",
    labelFr: "Bordereau de Livraison (préparé)",
    typeCode: "DELIVERY_NOTE",
    status: "partial",
    steps: ["am_dossier_opening", "transport_docs_transmission"],
    note: "CONFLATION. One DELIVERY_NOTE type ('Bon de livraison / POD') serves BOTH the BL prepared at step 3 AND the signed POD at steps 16-17. The official process treats these as two distinct artefacts at two distinct steps. This must be split in Phase 5.0D.",
  },
  {
    key: "VENDOR_INVOICE",
    labelFr: "Facture tierce payable pour le client",
    typeCode: null,
    status: "missing",
    steps: ["am_dossier_opening"],
    note: "No accounts-payable model at all. Finance is explicitly scoped 'no supplier bills'. COMMERCIAL_INVOICE is the customs-value invoice, not a vendor bill.",
  },
  {
    key: "SPENDING_AUTHORIZATION",
    labelFr: "Autorisation de dépense",
    typeCode: null,
    status: "missing",
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
    labelFr: "Référence de déclaration GAINDE",
    typeCode: null,
    status: "partial",
    steps: ["gainde_registration"],
    note: "customs_record.external_ref exists ('reserved for GAINDE/Orbus number (manual)') but it is a bare text field — no milestone, no actor, no date, no receipt. Keep it manual (DEC-B01); add the milestone, not an API.",
  },
  {
    key: "GAINDE_SUBMISSION_EVIDENCE",
    labelFr: "Preuve d'introduction des documents dans GAINDE",
    typeCode: null,
    status: "missing",
    steps: ["gainde_document_submission"],
    note: "No submission evidence of any kind.",
  },
  {
    key: "BON_A_ENLEVER",
    labelFr: "Bon à Enlever (BAE)",
    typeCode: null,
    status: "partial",
    steps: ["customs_field_clearance"],
    note: "customs_record.bae_reference exists and canRelease() requires it — but the BAE is a REFERENCE STRING, not an uploadable document. Promote it to a document type so the physical BAE can be attached as evidence.",
  },
  {
    key: "BON_A_DELIVRER",
    labelFr: "Bon à Délivrer (BAD)",
    typeCode: null,
    status: "missing",
    steps: ["bon_a_delivrer"],
    note: "Zero occurrences repo-wide. A hard prerequisite of the pickup join gate.",
  },
  {
    key: "PRE_GATE_AUTHORIZATION",
    labelFr: "Autorisation Pre-Gate",
    typeCode: null,
    status: "missing",
    steps: ["pre_gate", "transport_docs_transmission"],
    note: "Zero occurrences repo-wide. A hard prerequisite of the pickup join gate.",
  },
  {
    key: "SIGNED_DELIVERY_NOTE",
    labelFr: "Bordereau de Livraison signé (POD)",
    typeCode: "DELIVERY_NOTE",
    status: "mapped",
    steps: ["am_delivery_followup", "transport_pod_handoff"],
    note: "Works: POD_RECEIVED is already gated on an APPROVED DELIVERY_NOTE, and the driver flow captures DRIVER_SIGNATURE. But see BORDEREAU_LIVRAISON — the same type is doing double duty and must be split.",
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
    typeCode: null,
    status: "missing",
    steps: ["courier_deposit", "administration_proof_handoff"],
    note: "Zero occurrences repo-wide. Must record recipient and date, and must NOT mutate any financial status.",
  },
];

/** Document types that must be ADDED to public.document_type in Phase 5.0D. */
export const MISSING_DOCUMENT_TYPES = [
  "QUOTATION",
  "QUOTATION_APPROVAL",
  "TRANSPORT_REQUEST",
  "VENDOR_INVOICE",
  "SPENDING_AUTHORIZATION",
  "GAINDE_SUBMISSION_EVIDENCE",
  "BON_A_ENLEVER",
  "BON_A_DELIVRER",
  "PRE_GATE_AUTHORIZATION",
  "PROOF_OF_DEPOSIT",
];

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

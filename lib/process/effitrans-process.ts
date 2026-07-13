/**
 * THE canonical Effitrans operational process (Phase 5.0A) — PURE, one file.
 * ---------------------------------------------------------------------------
 * Source of truth: "PROCESSUS OPÉRATIONNEL – EFFITRANS" — 26 operational steps
 * plus a parallel customs/transport-preparation branch. Do not scatter step
 * definitions across pages, services or components: everything that describes
 * the official process lives here.
 *
 * This registry DESCRIBES the process. It does not run it. Phase 5.0B derives a
 * live instance per dossier from existing records — operational_file, document,
 * customs_record, transport_record, invoice, payment, task — so there is no
 * second status truth. `completionRule` is the stable code each derivation
 * implements.
 *
 * Each step also carries its Phase 5.0A audit verdict (`implementation`), so the
 * traceability matrix is machine-checkable. See
 * docs/phase-5.0a-workflow-traceability.md for the narrative version.
 */
import type {
  ClientJourneyStage,
  GateRequirement,
  MakerCheckerPair,
  ParallelGroup,
  ProcessActivity,
  ProcessDepartment,
  ProcessStep,
} from "./types";

// ------------------------------------------------------------------ steps ----

export const EFFITRANS_PROCESS: ProcessStep[] = [
  {
    stepNumber: 1,
    key: "cotation",
    labelFr: "Service Cotation — établir et faire valider le devis",
    internalLabel: "Cotation — devis préparé, envoyé, validé par le client",
    clientStage: "request_received",
    phase: "cotation",
    department: "cotation",
    role: "COTATION_OFFICER",
    description:
      "Préparer la cotation, l'envoyer au client, enregistrer sa validation, puis transmettre le dossier accepté au Responsable des Opérations. Étape applicable uniquement aux clients SANS contrat.",
    prerequisites: [],
    requiredDocuments: ["QUOTATION", "QUOTATION_APPROVAL"],
    requiredEvidence: ["client_approval_actor", "client_approval_date"],
    completionRule: "quotation_approved_or_client_under_contract",
    rejectsTo: null,
    nextSteps: ["operations_intake"],
    parallelGroup: "main",
    slaPolicyKey: "quotation_response",
    permissions: ["quotation:create", "quotation:send", "quotation:approve"],
    implementation: {
      verdict: "missing",
      existing: [
        "role QUOTATION_MANAGER exists but holds only profile:read:self / profile:update:self",
        "lib/files/lifecycle.ts step `quote_approved` is cosmetic (file.status !== 'DRAFT')",
      ],
      gaps: [
        "no quotation / quotation_line table",
        "no QUOTATION or QUOTATION_APPROVAL document type",
        "no client.has_contract flag — nothing distinguishes contract from non-contract clients",
        "no quotation:* permissions",
        "no conversion-to-dossier action; dossier activation is not gated on approval",
      ],
    },
  },
  {
    stepNumber: 2,
    key: "operations_intake",
    labelFr: "Responsable des Opérations — réception et affectation",
    internalLabel: "Intake opérations — affecter le dossier à l'Account Manager du client",
    clientStage: "request_received",
    phase: "intake",
    department: "operations",
    role: "OPERATIONS_MANAGER",
    description:
      "Recevoir le dossier accepté et l'affecter à l'Account Manager responsable du client. L'affectation est notifiée, historisée et visible sur le dossier.",
    prerequisites: ["cotation"],
    requiredDocuments: [],
    requiredEvidence: ["account_manager_id", "assignment_actor", "assignment_date"],
    completionRule: "account_manager_assigned",
    rejectsTo: null,
    nextSteps: ["am_dossier_opening"],
    parallelGroup: "main",
    slaPolicyKey: "operations_assignment",
    permissions: ["file:assign"],
    implementation: {
      verdict: "partial",
      existing: [
        "role OPS_SUPERVISOR (semantically equivalent to OPERATIONS_MANAGER)",
        "operational_file.account_manager_id, operational_file.assigned_to_user_id",
        "assignFile() — file:assign, writes audit_log (file.assigned) + notification",
      ],
      gaps: [
        "account_manager_id is auto-set to the CREATOR at createFile and no action ever changes it",
        "two competing ownership columns (account_manager_id vs assigned_to_user_id)",
        "no operations intake queue",
        "no assignment history table — history exists only as audit_log rows",
      ],
    },
  },
  {
    stepNumber: 3,
    key: "am_dossier_opening",
    labelFr: "Account Manager — ouverture et préparation du dossier",
    internalLabel:
      "Ouverture dossier + demande de transport, BL, factures tiers, autorisations de dépense",
    clientStage: "documentation_in_preparation",
    phase: "preparation",
    department: "account_management",
    role: "ACCOUNT_MANAGER",
    description:
      "Ouvrir le dossier et générer son identifiant, envoyer l'accusé de réception au client, compléter les informations, enregistrer le dossier au tableau de suivi. Préparer la demande de transport et le Bordereau de Livraison, demander et vérifier les factures tierces payables pour le client, préparer les autorisations de dépense. Transmettre au Coordinateur.",
    prerequisites: ["operations_intake"],
    requiredDocuments: [
      "TRANSPORT_REQUEST",
      "BORDEREAU_LIVRAISON",
      "VENDOR_INVOICE",
      "SPENDING_AUTHORIZATION",
    ],
    requiredEvidence: ["file_number", "client_acknowledgment_sent", "vendor_invoices_verified"],
    completionRule: "dossier_opened_and_preparation_complete",
    rejectsTo: null,
    nextSteps: ["coordinator_reception"],
    parallelGroup: "main",
    slaPolicyKey: "dossier_opening",
    permissions: ["file:create", "file:update", "document:create"],
    implementation: {
      verdict: "partial",
      existing: [
        "createFile() + next_file_number() → EFT-IMP-2026-00001",
        "document_type.required_for + getMissingRequiredDocuments() (warn-only)",
        "DELIVERY_NOTE document type (conflated: serves both the prepared BL and the signed POD)",
        "TRANSPORT_ORDER document type (a subcontractor order, not a transport request)",
      ],
      gaps: [
        "no client acknowledgment event — the 7 customer-notify events have no 'dossier opened'",
        "no TRANSPORT_REQUEST document type",
        "no VENDOR_INVOICE type and no accounts-payable model (finance is explicitly 'no supplier bills')",
        "no SPENDING_AUTHORIZATION type or workflow — zero occurrences repo-wide",
        "BL is not separable from POD",
        "no handoff to Coordinator (task.handoff_type has no COORDINATOR value)",
      ],
    },
  },
  {
    stepNumber: 4,
    key: "coordinator_reception",
    labelFr: "Coordinateur — confirmer la réception et transmettre au Chef de Transit",
    internalLabel: "Coordination — accusé de réception explicite, puis transmission au Transit",
    clientStage: null,
    phase: "customs",
    department: "coordination",
    role: "COORDINATOR",
    description:
      "Confirmer explicitement la réception du dossier, puis le transmettre au Chef de Transit. Aucun changement de statut silencieux : la réception est un acte tracé.",
    prerequisites: ["am_dossier_opening"],
    requiredDocuments: [],
    requiredEvidence: ["reception_confirmed_by", "reception_confirmed_at"],
    completionRule: "handoff_received_and_forwarded",
    rejectsTo: "am_dossier_opening",
    nextSteps: ["transit_declarant_assignment"],
    parallelGroup: "customs",
    slaPolicyKey: "coordinator_reception",
    permissions: ["process:handoff:receive", "process:handoff:send"],
    implementation: {
      verdict: "missing",
      existing: ["role COORDINATOR exists"],
      gaps: [
        "no reception-confirmation concept anywhere — a handoff task goes TODO → DONE with nothing in between",
        "'no silent status change' is unenforceable today because there is no receive step to enforce",
        "no coordinator handoff type",
      ],
    },
  },
  {
    stepNumber: 5,
    key: "transit_declarant_assignment",
    labelFr: "Chef de Transit — réception et affectation du Déclarant",
    internalLabel: "Transit — affecter un Déclarant au dossier",
    clientStage: null,
    phase: "customs",
    department: "transit",
    role: "CHIEF_TRANSIT",
    description: "Recevoir le dossier et affecter un Déclarant. L'affectation est notifiée et historisée.",
    prerequisites: ["coordinator_reception"],
    requiredDocuments: [],
    requiredEvidence: ["declarant_id", "assignment_date"],
    completionRule: "declarant_assigned",
    rejectsTo: null,
    nextSteps: ["customs_preparation"],
    parallelGroup: "customs",
    slaPolicyKey: "declarant_assignment",
    permissions: ["customs:assign"],
    implementation: {
      verdict: "missing",
      existing: ["role CHIEF_OF_TRANSIT exists (requires the customsBroker capability)"],
      gaps: [
        "customs_record has no declarant_id column",
        "no declarant-assignment action, no transit queue, no assignment history",
        "no customs:assign permission",
      ],
    },
  },
  {
    stepNumber: 6,
    key: "customs_preparation",
    labelFr: "Déclarant — préparer le dossier de dédouanement",
    internalLabel: "Déclaration — préparer le dossier douane et le soumettre à validation",
    clientStage: "customs_processing",
    phase: "customs",
    department: "customs_declaration",
    role: "CUSTOMS_DECLARANT",
    description:
      "Préparer le dossier de dédouanement à partir des documents requis, puis le soumettre au Chef de Transit pour validation. Le préparateur est enregistré.",
    prerequisites: ["transit_declarant_assignment"],
    requiredDocuments: ["CUSTOMS_DOSSIER"],
    requiredEvidence: ["prepared_by", "prepared_at"],
    completionRule: "customs_dossier_submitted_for_validation",
    rejectsTo: null,
    nextSteps: ["transit_validation"],
    parallelGroup: "customs",
    slaPolicyKey: "customs_preparation",
    permissions: ["customs:create", "customs:update"],
    implementation: {
      verdict: "partial",
      existing: [
        "role CUSTOMS_DECLARANT exists",
        "customs_record.status = DECLARATION_PREPARED",
        "canDeclare() blocks DECLARED until every gates_customs document is present",
      ],
      gaps: [
        "no 'submitted for validation' state",
        "preparer identity is not recorded (customs_record has no prepared_by)",
        "no route to the Chief Transit",
      ],
    },
  },
  {
    stepNumber: 7,
    key: "transit_validation",
    labelFr: "Chef de Transit — vérifier et valider le dossier douane",
    internalLabel: "Transit — contrôle maker-checker, validation ou rejet motivé",
    clientStage: null,
    phase: "customs",
    department: "transit",
    role: "CHIEF_TRANSIT",
    description:
      "Vérifier et valider le dossier de dédouanement préparé par le Déclarant, puis le retourner au Coordinateur. Le préparateur ne peut pas s'auto-valider. Un rejet exige un motif et renvoie le dossier au Déclarant pour correction.",
    prerequisites: ["customs_preparation"],
    requiredDocuments: ["CUSTOMS_DOSSIER"],
    requiredEvidence: ["validated_by", "validated_at", "rejection_reason_if_rejected"],
    completionRule: "customs_dossier_validated_by_distinct_actor",
    rejectsTo: "customs_preparation",
    nextSteps: ["coordinator_to_finance"],
    parallelGroup: "customs",
    slaPolicyKey: "chief_transit_validation",
    permissions: ["customs:validate"],
    implementation: {
      verdict: "missing",
      existing: [
        "role CHIEF_OF_TRANSIT exists and correctly holds customs:release (withheld from the Declarant)",
        "customs_record.reviewed_by exists — but it is written by releaseCustoms (the BAE step), not a validation step",
      ],
      gaps: [
        "NO maker-checker separation exists anywhere in the codebase — zero code paths check that an approver differs from the preparer",
        "no validation step, no customs:validate permission",
        "no rejection/correction loop, no reason, no resubmission tracking",
      ],
    },
  },
  {
    stepNumber: 8,
    key: "coordinator_to_finance",
    labelFr: "Coordinateur — transmettre le dossier à la Finance",
    internalLabel: "Coordination — remise au guichet Finance pour enregistrement GAINDE",
    clientStage: null,
    phase: "customs",
    department: "coordination",
    role: "COORDINATOR",
    description: "Transmettre le dossier douane validé au service Finance pour enregistrement de la déclaration.",
    prerequisites: ["transit_validation"],
    requiredDocuments: [],
    requiredEvidence: ["handoff_sent_at"],
    completionRule: "handoff_received_and_forwarded",
    rejectsTo: "transit_validation",
    nextSteps: ["gainde_registration"],
    parallelGroup: "customs",
    slaPolicyKey: "coordinator_reception",
    permissions: ["process:handoff:send"],
    implementation: {
      verdict: "missing",
      existing: ["role COORDINATOR exists"],
      gaps: ["no handoff type", "no Finance customs-registration queue"],
    },
  },
  {
    stepNumber: 9,
    key: "gainde_registration",
    labelFr: "Finance (fonction douane) — enregistrer la déclaration dans GAINDE",
    internalLabel: "Finance douane — jalon manuel : référence GAINDE + date + agent + reçu",
    clientStage: "customs_processing",
    phase: "customs",
    department: "finance_customs",
    role: "CUSTOMS_FINANCE_OFFICER",
    description:
      "Enregistrer la déclaration dans GAINDE, puis retourner le dossier au Coordinateur. Action opérationnelle réalisée par la Finance AVANT que le Déclarant n'introduise les documents justificatifs (étape 11). Jalon manuel : aucune automatisation API.",
    prerequisites: ["coordinator_to_finance"],
    requiredDocuments: [],
    requiredEvidence: [
      "gainde_declaration_reference",
      "registration_date",
      "registered_by",
      "registration_receipt",
    ],
    completionRule: "gainde_registration_milestone_recorded",
    rejectsTo: null,
    nextSteps: ["coordinator_to_declarant"],
    parallelGroup: "customs",
    slaPolicyKey: "gainde_registration",
    permissions: ["customs:register"],
    implementation: {
      verdict: "partial",
      existing: [
        "customs_record.declaration_number, declaration_date",
        "customs_record.external_ref — commented 'reserved for GAINDE/Orbus number (manual)'",
        "DEC-B01: manual reference tracking, no GAINDE API (correct — keep it that way)",
      ],
      gaps: [
        "RBAC ACTIVELY FORBIDS THIS STEP — FINANCE_OFFICER holds no customs:* permission at all",
        "no CUSTOMS_FINANCE_OFFICER role",
        "no registration milestone: no actor, no date, no receipt/evidence, no ordering constraint vs step 11",
        "no future connector seam",
      ],
    },
  },
  {
    stepNumber: 10,
    key: "coordinator_to_declarant",
    labelFr: "Coordinateur — retourner le dossier au Déclarant",
    internalLabel: "Coordination — remise post-enregistrement au Déclarant",
    clientStage: null,
    phase: "customs",
    department: "coordination",
    role: "COORDINATOR",
    description:
      "Après enregistrement de la déclaration, transmettre le dossier au Déclarant pour introduction des documents justificatifs.",
    prerequisites: ["gainde_registration"],
    requiredDocuments: [],
    requiredEvidence: ["handoff_sent_at"],
    completionRule: "handoff_received_and_forwarded",
    rejectsTo: null,
    nextSteps: ["gainde_document_submission"],
    parallelGroup: "customs",
    slaPolicyKey: "coordinator_reception",
    permissions: ["process:handoff:send"],
    implementation: {
      verdict: "missing",
      existing: ["role COORDINATOR exists"],
      gaps: ["no post-registration handoff"],
    },
  },
  {
    stepNumber: 11,
    key: "gainde_document_submission",
    labelFr: "Déclarant — introduire les documents dans GAINDE",
    internalLabel: "Déclaration — jalon manuel : dépôt des justificatifs GAINDE",
    clientStage: "customs_processing",
    phase: "customs",
    department: "customs_declaration",
    role: "CUSTOMS_DECLARANT",
    description:
      "Introduire les documents justificatifs dans GAINDE, puis retourner le dossier au Coordinateur. Ne peut avoir lieu qu'APRÈS l'enregistrement de la déclaration par la Finance (étape 9).",
    prerequisites: ["coordinator_to_declarant", "gainde_registration"],
    requiredDocuments: ["GAINDE_SUBMISSION_EVIDENCE"],
    requiredEvidence: ["submitted_document_list", "submission_date", "submitted_by"],
    completionRule: "gainde_documents_submitted_after_registration",
    rejectsTo: null,
    nextSteps: ["customs_followup"],
    parallelGroup: "customs",
    slaPolicyKey: "customs_document_submission",
    permissions: ["customs:update"],
    implementation: {
      verdict: "missing",
      existing: ["role CUSTOMS_DECLARANT exists"],
      gaps: [
        "no submission milestone, no submitted-document list, no evidence/reference",
        "no GAINDE_SUBMISSION_EVIDENCE document type",
        "the ordering constraint (step 9 strictly before step 11) is unenforceable today",
      ],
    },
  },
  {
    stepNumber: 12,
    key: "customs_followup",
    labelFr: "Coordinateur — suivre le dossier en douane et affecter l'Agent de Terrain",
    internalLabel: "Coordination — suivi douane, affectation Agent de Terrain",
    clientStage: "customs_processing",
    phase: "customs",
    department: "coordination",
    role: "COORDINATOR",
    description:
      "Déposer et suivre le dossier dans le système douanier, puis l'affecter à l'Agent de Terrain pour le circuit douane.",
    prerequisites: ["gainde_document_submission"],
    requiredDocuments: [],
    requiredEvidence: ["field_agent_id"],
    completionRule: "field_agent_assigned",
    rejectsTo: null,
    nextSteps: ["customs_field_clearance"],
    parallelGroup: "customs",
    slaPolicyKey: "customs_followup",
    permissions: ["customs:update", "customs:assign"],
    implementation: {
      verdict: "partial",
      existing: ["customs_record.status = UNDER_REVIEW / INSPECTION", "role COORDINATOR exists"],
      gaps: [
        "no CUSTOMS_FIELD_AGENT role",
        "no field-agent assignment",
        "no customs follow-up state distinct from UNDER_REVIEW",
      ],
    },
  },
  {
    stepNumber: 13,
    key: "customs_field_clearance",
    labelFr: "Agent de Terrain — obtenir le Bon à Enlever et lever le dossier",
    internalLabel: "Douane terrain — circuit, BAE, formalités de sortie",
    clientStage: "customs_released",
    phase: "customs",
    department: "customs_field",
    role: "CUSTOMS_FIELD_AGENT",
    description:
      "Suivre le dossier auprès de la Douane, obtenir le Bon à Enlever (BAE) et accomplir les formalités de sortie. Le BAE est la porte physique : rien ne quitte la zone douanière sans lui.",
    prerequisites: ["customs_followup"],
    requiredDocuments: ["BON_A_ENLEVER"],
    requiredEvidence: ["bae_reference", "bae_obtained_at", "customs_circuit"],
    completionRule: "bae_obtained_and_customs_released",
    rejectsTo: null,
    nextSteps: ["pickup"],
    parallelGroup: "customs",
    slaPolicyKey: "bae_followup",
    permissions: ["customs:release"],
    implementation: {
      verdict: "partial",
      existing: [
        "customs_record.bae_reference",
        "canRelease() requires a BAE reference before RELEASED",
        "customs:release is correctly withheld from CUSTOMS_DECLARANT",
        "canPickup() already hard-gates PICKED_UP on customs RELEASED (with a customs_override escape hatch)",
      ],
      gaps: [
        "no CUSTOMS_FIELD_AGENT role or queue",
        "BAE is a text field, not an uploadable document",
        "no customs circuit (rouge/orange/vert) as a typed field — it exists only as free text in the dead mock module",
        "no port-exit formality model",
      ],
    },
  },
  {
    stepNumber: 14,
    key: "transport_assignment",
    labelFr: "Service Transport — affecter le véhicule et communiquer le suivi",
    internalLabel: "Transport — véhicule, chauffeur, lien de suivi, coordonnées",
    clientStage: "transport_preparation",
    phase: "transport_readiness",
    department: "transport",
    role: "TRANSPORT_OFFICER",
    description:
      "Affecter un véhicule, communiquer le lien de suivi, le nom du chauffeur, le numéro du véhicule et le téléphone du chauffeur. Branche parallèle : progresse indépendamment de la chaîne douane.",
    prerequisites: ["am_dossier_opening"],
    requiredDocuments: [],
    requiredEvidence: ["vehicle_assigned", "driver_assigned", "tracking_link", "driver_contact"],
    completionRule: "vehicle_and_driver_assigned",
    rejectsTo: null,
    nextSteps: ["pickup"],
    parallelGroup: "transport_readiness",
    slaPolicyKey: "transport_assignment",
    permissions: ["transport:assign"],
    implementation: {
      verdict: "partial",
      existing: [
        "transport_record.driver_name / driver_phone / vehicle_plate / trailer_or_container (free text)",
        "transport_record.driver_user_id → app_user (validated active same-tenant DRIVER)",
        "assignTransport() and assignDriverUser() — both behind transport:assign",
        "role TRANSPORT_OFFICER exists (requires the roadTransport capability)",
      ],
      gaps: [
        "NO tracking link exists — customer tracking is authenticated-portal-only and every tracking flag is dark by default",
        "no vehicle master table — vehicle_plate is a free string with no availability/status model",
        "customer-safe driver-contact policy is undefined (driver_phone is stored but never exposed)",
      ],
    },
  },
  {
    stepNumber: 15,
    key: "pickup",
    labelFr: "Agent d'Enlèvement — enlever la marchandise et sortir du port",
    internalLabel: "Enlèvement — point de convergence douane × transport",
    clientStage: "pickup_completed",
    phase: "delivery",
    department: "pickup",
    role: "PICKUP_AGENT",
    description:
      "Enlever la marchandise, accomplir les formalités de sortie du port et coordonner avec le Transport et le Coordinateur. JOINTURE : les branches douane et transport convergent ici — voir PICKUP_READINESS.",
    prerequisites: ["customs_field_clearance", "transport_assignment"],
    requiredDocuments: [],
    requiredEvidence: ["pickup_confirmed_at", "port_exit_evidence"],
    completionRule: "pickup_confirmed_after_readiness_gate",
    rejectsTo: null,
    nextSteps: ["am_delivery_followup"],
    parallelGroup: "main",
    slaPolicyKey: "pickup",
    permissions: ["transport:update"],
    implementation: {
      verdict: "partial",
      existing: [
        "transport_record.status = PICKED_UP",
        "canPickup() gate on customs RELEASED",
        "driver can record PICKUP_CONFIRMED and upload PICKUP_PHOTO",
      ],
      gaps: [
        "no PICKUP_AGENT role — DRIVER is a narrow mobile identity (tracking only, no dossier access)",
        "no port-exit formality evidence",
        "canPickup() is single-criterion; the official join gate has six requirements",
        "no coordination-visibility surface",
      ],
    },
  },
  {
    stepNumber: 16,
    key: "am_delivery_followup",
    labelFr: "Account Manager — suivre la livraison jusqu'à réception client",
    internalLabel: "Account Management — suivi livraison, obtention du BL signé",
    clientStage: "delivered",
    phase: "delivery",
    department: "account_management",
    role: "ACCOUNT_MANAGER",
    description:
      "Communiquer les informations de livraison au client, suivre la livraison jusqu'à réception, et obtenir le Bordereau de Livraison signé.",
    prerequisites: ["pickup"],
    requiredDocuments: ["SIGNED_DELIVERY_NOTE"],
    requiredEvidence: ["recipient_name", "delivered_at"],
    completionRule: "delivered_with_signed_bl",
    rejectsTo: null,
    nextSteps: ["transport_pod_handoff"],
    parallelGroup: "main",
    slaPolicyKey: "delivery_followup",
    permissions: ["transport:complete", "communication:send"],
    implementation: {
      verdict: "partial",
      existing: [
        "customer-notify `delivered` event",
        "driver confirmDelivery() requires recipientName; accepts a DRIVER_SIGNATURE document",
        "POD = an APPROVED DELIVERY_NOTE document (canReceivePod)",
      ],
      gaps: [
        "no Account Manager delivery-follow-up workspace",
        "the signed BL is conflated with the POD (one DELIVERY_NOTE type serves both)",
      ],
    },
  },
  {
    stepNumber: 17,
    key: "transport_pod_handoff",
    labelFr: "Service Transport — remettre le BL signé au Coordinateur",
    internalLabel: "Transport → Coordination — remise du POD, vérification documentaire",
    clientStage: null,
    phase: "delivery",
    department: "transport",
    role: "TRANSPORT_OFFICER",
    description: "Transmettre le Bordereau de Livraison signé au Coordinateur pour vérification.",
    prerequisites: ["am_delivery_followup"],
    requiredDocuments: ["SIGNED_DELIVERY_NOTE"],
    requiredEvidence: ["pod_verified_at"],
    completionRule: "pod_received_and_forwarded_to_coordinator",
    rejectsTo: "am_delivery_followup",
    nextSteps: ["coordinator_completeness"],
    parallelGroup: "main",
    slaPolicyKey: "pod_collection",
    permissions: ["transport:complete", "process:handoff:send"],
    implementation: {
      verdict: "partial",
      existing: [
        "transport_record.status = POD_RECEIVED, gated on an APPROVED DELIVERY_NOTE",
      ],
      gaps: [
        "MIS-ROUTED: POD_RECEIVED fires FINANCE_HANDOFF directly, skipping the Coordinator (18) and Account Manager (19) completeness checkpoints entirely. Officially: POD → Coordinator → AM → Billing.",
        "no transport → coordinator handoff",
      ],
    },
  },
  {
    stepNumber: 18,
    key: "coordinator_completeness",
    labelFr: "Coordinateur — vérifier la complétude et ajouter les justificatifs",
    internalLabel: "Coordination — 1er contrôle de complétude, reçus et preuves de paiement",
    clientStage: null,
    phase: "completeness",
    department: "coordination",
    role: "COORDINATOR",
    description:
      "Vérifier la complétude du dossier, y ajouter les reçus et les preuves de paiement, puis le transmettre à l'Account Manager. Premier des deux points de contrôle avant facturation.",
    prerequisites: ["transport_pod_handoff"],
    requiredDocuments: ["RECEIPT", "PAYMENT_PROOF"],
    requiredEvidence: ["completeness_checked_by", "completeness_checked_at"],
    completionRule: "coordinator_completeness_passed",
    rejectsTo: "transport_pod_handoff",
    nextSteps: ["am_completeness"],
    parallelGroup: "main",
    slaPolicyKey: "completeness_review",
    permissions: ["process:completeness:review"],
    implementation: {
      verdict: "missing",
      existing: ["PAYMENT_RECEIPT document type exists (serves both receipts and payment proofs)"],
      gaps: [
        "no post-delivery completeness review at all",
        "no receipts / payment-proof checklist",
        "no correction loop",
      ],
    },
  },
  {
    stepNumber: 19,
    key: "am_completeness",
    labelFr: "Account Manager — vérifier la complétude et transmettre à la Facturation",
    internalLabel: "Account Management — 2e contrôle de complétude, porte de facturation",
    clientStage: null,
    phase: "completeness",
    department: "account_management",
    role: "ACCOUNT_MANAGER",
    description:
      "Vérifier la complétude du dossier et le transmettre au service Facturation. Aucune facture ne peut être créée tant que les justificatifs requis ne sont pas présents.",
    prerequisites: ["coordinator_completeness"],
    requiredDocuments: [],
    requiredEvidence: ["billing_readiness_confirmed_by", "billing_readiness_confirmed_at"],
    completionRule: "billing_ready",
    rejectsTo: "coordinator_completeness",
    nextSteps: ["billing_draft"],
    parallelGroup: "main",
    slaPolicyKey: "completeness_review",
    permissions: ["process:completeness:review"],
    implementation: {
      verdict: "missing",
      existing: [],
      gaps: [
        "no second completeness checkpoint",
        "NO BILLING-READINESS GATE — an invoice can be created and issued at any time, on any dossier, with no evidence present",
      ],
    },
  },
  {
    stepNumber: 20,
    key: "billing_draft",
    labelFr: "Service Facturation — établir la facture",
    internalLabel: "Facturation — brouillon de facture, soumission à la Finance",
    clientStage: null,
    phase: "billing",
    department: "billing",
    role: "BILLING_OFFICER",
    description:
      "Créer la facture à partir des charges du dossier et la soumettre à la Finance pour validation.",
    prerequisites: ["am_completeness"],
    requiredDocuments: [],
    requiredEvidence: ["invoice_id", "drafted_by"],
    completionRule: "invoice_drafted_and_submitted_for_validation",
    rejectsTo: null,
    nextSteps: ["finance_invoice_validation"],
    parallelGroup: "main",
    slaPolicyKey: "billing_draft",
    permissions: ["finance:create"],
    implementation: {
      verdict: "partial",
      existing: [
        "invoice.status = DRAFT",
        "billing_charge → invoice_line derivation",
        "next_invoice_number() → EFT-INV-2026-00001 (assigned on issue)",
      ],
      gaps: [
        "no BILLING_OFFICER role — no tenant billing role exists (PLATFORM_BILLING is a different namespace and cannot be assigned to tenant staff)",
        "no billing → finance approval workflow",
      ],
    },
  },
  {
    stepNumber: 21,
    key: "finance_invoice_validation",
    labelFr: "Service Finance — contrôler et valider la facture",
    internalLabel: "Finance — contrôle maker-checker de la facture, validation ou rejet motivé",
    clientStage: null,
    phase: "billing",
    department: "finance",
    role: "FINANCE_OFFICER",
    description:
      "Contrôler la facture, la valider, puis la retourner à la Facturation. Le rédacteur de la facture ne peut pas la valider lui-même. Un rejet exige un motif et renvoie la facture à la Facturation.",
    prerequisites: ["billing_draft"],
    requiredDocuments: [],
    requiredEvidence: ["validated_by", "validated_at", "rejection_reason_if_rejected"],
    completionRule: "invoice_validated_by_distinct_actor",
    rejectsTo: "billing_draft",
    nextSteps: ["billing_dispatch"],
    parallelGroup: "main",
    slaPolicyKey: "invoice_validation",
    permissions: ["finance:validate"],
    implementation: {
      verdict: "missing",
      existing: ["role FINANCE_OFFICER exists"],
      gaps: [
        "invoice.status has NO VALIDATED state (DRAFT → ISSUED → PARTIALLY_PAID → PAID / VOID)",
        "the same FINANCE_OFFICER can create AND issue the same invoice — no separate approver",
        "docs/state-machine.md admits the AM-validation gate was an 'auto-pass placeholder'",
        "no finance:validate permission, no rejection loop",
      ],
    },
  },
  {
    stepNumber: 22,
    key: "billing_dispatch",
    labelFr: "Service Facturation — envoyer la facture et transmettre à l'Administration",
    internalLabel: "Facturation — e-mail client, dépôt physique, archivage",
    clientStage: "invoice_issued",
    phase: "billing",
    department: "billing",
    role: "BILLING_OFFICER",
    description:
      "Envoyer la facture au client par e-mail, la transmettre à l'Administration pour dépôt physique, et transmettre le dossier complet à l'Administration pour archivage.",
    prerequisites: ["finance_invoice_validation"],
    requiredDocuments: ["FINAL_INVOICE"],
    requiredEvidence: ["emailed_at", "prepared_for_deposit_at"],
    completionRule: "invoice_emailed_and_queued_for_deposit",
    rejectsTo: null,
    nextSteps: ["administration_deposit_prep"],
    parallelGroup: "main",
    slaPolicyKey: "invoice_dispatch",
    permissions: ["finance:issue", "communication:send"],
    implementation: {
      verdict: "partial",
      existing: [
        "issueInvoice() fires the invoice_issued customer email",
        "ARCHIVE_HANDOFF exists as a task.handoff_type value",
      ],
      gaps: [
        "no invoice-delivery status split (emailed / prepared for physical deposit / physically deposited)",
        "no physical-deposit queue, no archiving queue",
        "AuditActions.FILE_ARCHIVED is dead code, there is no ARCHIVED status, and operational_file.archived_at is never written",
      ],
    },
  },
  {
    stepNumber: 23,
    key: "administration_deposit_prep",
    labelFr: "Service Administratif — préparer le dépôt et affecter un Coursier",
    internalLabel: "Administration — préparation du pli, affectation Coursier, archivage",
    clientStage: null,
    phase: "deposit",
    department: "administration",
    role: "ADMINISTRATIVE_OFFICER",
    description:
      "Préparer la facture pour dépôt physique, l'affecter à un Coursier, et archiver le dossier. L'archivage n'est PAS la clôture financière.",
    prerequisites: ["billing_dispatch"],
    requiredDocuments: ["FINAL_INVOICE"],
    requiredEvidence: ["courier_id", "deposit_package_prepared_at", "archived_at"],
    completionRule: "courier_assigned_and_dossier_archived",
    rejectsTo: null,
    nextSteps: ["courier_deposit"],
    parallelGroup: "main",
    slaPolicyKey: "physical_deposit",
    permissions: ["admin_service:manage", "courier:assign"],
    implementation: {
      verdict: "missing",
      existing: [
        "operational_file.archived_at column exists (never written)",
        "SYSTEM_ADMIN exists but is the IT/config admin, not an administrative service",
      ],
      gaps: [
        "no ADMINISTRATIVE_OFFICER role",
        "no courier assignment, no deposit package, no archive action",
        "archive must not equal financial closure — no such distinction exists",
      ],
    },
  },
  {
    stepNumber: 24,
    key: "courier_deposit",
    labelFr: "Coursier — déposer la facture chez le client",
    internalLabel: "Coursier — dépôt physique, preuve de dépôt",
    clientStage: null,
    phase: "deposit",
    department: "courier",
    role: "COURIER",
    description:
      "Déposer la facture chez le client et retourner la preuve de dépôt à l'Administration. Le Coursier ne modifie AUCUN statut financier.",
    prerequisites: ["administration_deposit_prep"],
    requiredDocuments: ["PROOF_OF_DEPOSIT"],
    requiredEvidence: ["deposit_recipient", "deposited_at"],
    completionRule: "proof_of_deposit_uploaded",
    rejectsTo: null,
    nextSteps: ["administration_proof_handoff"],
    parallelGroup: "main",
    slaPolicyKey: "physical_deposit",
    permissions: ["courier:deposit"],
    implementation: {
      verdict: "missing",
      existing: [],
      gaps: [
        "no COURIER role — zero occurrences of 'courier' repo-wide",
        "no courier workspace or task",
        "no PROOF_OF_DEPOSIT document type",
      ],
    },
  },
  {
    stepNumber: 25,
    key: "administration_proof_handoff",
    labelFr: "Service Administratif — transmettre la preuve de dépôt au Recouvrement",
    internalLabel: "Administration — validation de la preuve, remise au Recouvrement",
    clientStage: null,
    phase: "deposit",
    department: "administration",
    role: "ADMINISTRATIVE_OFFICER",
    description: "Valider la preuve de dépôt et la transmettre au service Recouvrement.",
    prerequisites: ["courier_deposit"],
    requiredDocuments: ["PROOF_OF_DEPOSIT"],
    requiredEvidence: ["proof_validated_by"],
    completionRule: "proof_validated_and_forwarded",
    rejectsTo: "courier_deposit",
    nextSteps: ["collections"],
    parallelGroup: "main",
    slaPolicyKey: "physical_deposit",
    permissions: ["admin_service:manage", "process:handoff:send"],
    implementation: {
      verdict: "missing",
      existing: [],
      gaps: ["no ADMINISTRATIVE_OFFICER role", "no proof validation", "no collections handoff"],
    },
  },
  {
    stepNumber: 26,
    key: "collections",
    labelFr: "Service Recouvrement — suivre les échéances et clôturer le dossier",
    internalLabel: "Recouvrement — échéances, relances, encaissement, clôture",
    clientStage: "payment_closure",
    phase: "collections",
    department: "collections",
    role: "COLLECTIONS_OFFICER",
    description:
      "Suivre les échéances, recouvrer les créances, et clôturer le dossier APRÈS paiement intégral. Livré ne vaut pas clôturé : la clôture exige le paiement intégral et l'achèvement opérationnel.",
    prerequisites: ["administration_proof_handoff"],
    requiredDocuments: [],
    requiredEvidence: ["full_payment_confirmed_at", "closed_by"],
    completionRule: "fully_paid_and_operationally_complete",
    rejectsTo: null,
    nextSteps: [],
    parallelGroup: "main",
    slaPolicyKey: "collections_followup",
    permissions: ["collections:manage", "file:update"],
    implementation: {
      verdict: "partial",
      existing: [
        "invoice.due_date (defaults to issue + 30 days)",
        "isOverdue() derived boolean; overdueCount KPI; collectionRate analytics",
        "partial payments fully supported (PARTIALLY_PAID, Σ non-reversed payments)",
        "manual reconciliation queue",
        "DELIVERED and CLOSED are already distinct statuses",
      ],
      gaps: [
        "no COLLECTIONS_OFFICER role, no collections queue, no aging buckets",
        "no reminders/dunning — the only 'recovery' is a suggested text string in the risk engine",
        "CLOSURE IS NOT GATED ON PAYMENT: canCloseFile() only checks customs release, so a dossier with a DRAFT invoice and zero payments can be CLOSED today",
      ],
    },
  },
];

// ----------------------------------------------------- parallel activities ----

/**
 * The Account Manager's parallel commercial/transport-readiness branch. The
 * official document lists these WITHOUT step numbers — they are not part of the
 * 26 — but they are hard prerequisites of the pickup join gate (step 15) and run
 * concurrently with the customs chain (steps 4–13).
 */
export const PARALLEL_ACTIVITIES: ProcessActivity[] = [
  {
    stepNumber: null,
    key: "bon_a_delivrer",
    labelFr: "Account Manager — obtenir le Bon à Délivrer auprès du transporteur",
    internalLabel: "Préparation transport — Bon à Délivrer (BAD)",
    clientStage: "transport_preparation",
    phase: "transport_readiness",
    department: "account_management",
    role: "ACCOUNT_MANAGER",
    description:
      "Obtenir le Bon à Délivrer auprès du transporteur. Prérequis d'enlèvement — progresse en parallèle de la chaîne douane.",
    prerequisites: ["am_dossier_opening"],
    requiredDocuments: ["BON_A_DELIVRER"],
    requiredEvidence: ["bad_reference", "bad_obtained_at"],
    completionRule: "bon_a_delivrer_obtained",
    nextSteps: ["pickup"],
    parallelGroup: "transport_readiness",
    slaPolicyKey: "transport_assignment",
    permissions: ["document:create"],
    implementation: {
      verdict: "missing",
      existing: [],
      gaps: ["zero occurrences of Bon à Délivrer / BAD repo-wide", "no BON_A_DELIVRER document type"],
    },
  },
  {
    stepNumber: null,
    key: "pre_gate",
    labelFr: "Account Manager — obtenir l'autorisation Pre-Gate du terminal",
    internalLabel: "Préparation transport — autorisation Pre-Gate",
    clientStage: "transport_preparation",
    phase: "transport_readiness",
    department: "account_management",
    role: "ACCOUNT_MANAGER",
    description:
      "Obtenir l'autorisation Pre-Gate du terminal. Prérequis d'enlèvement — progresse en parallèle de la chaîne douane.",
    prerequisites: ["am_dossier_opening"],
    requiredDocuments: ["PRE_GATE_AUTHORIZATION"],
    requiredEvidence: ["pre_gate_reference", "pre_gate_obtained_at"],
    completionRule: "pre_gate_obtained",
    nextSteps: ["pickup"],
    parallelGroup: "transport_readiness",
    slaPolicyKey: "transport_assignment",
    permissions: ["document:create"],
    implementation: {
      verdict: "missing",
      existing: [],
      gaps: ["zero occurrences of Pre-Gate repo-wide", "no PRE_GATE_AUTHORIZATION document type"],
    },
  },
  {
    stepNumber: null,
    key: "transport_docs_transmission",
    labelFr:
      "Account Manager — transmettre le Pre-Gate et le Bordereau de Livraison au Coordinateur et au Transport",
    internalLabel: "Préparation transport — diffusion Pre-Gate + BL (2 destinataires)",
    clientStage: "transport_preparation",
    phase: "transport_readiness",
    department: "account_management",
    role: "ACCOUNT_MANAGER",
    description:
      "Transmettre l'autorisation Pre-Gate et le Bordereau de Livraison au Coordinateur ET au Service Transport.",
    prerequisites: ["pre_gate", "bon_a_delivrer"],
    requiredDocuments: ["PRE_GATE_AUTHORIZATION", "BORDEREAU_LIVRAISON"],
    requiredEvidence: ["recipients"],
    completionRule: "transport_documents_transmitted",
    nextSteps: ["pickup"],
    parallelGroup: "transport_readiness",
    slaPolicyKey: "transport_assignment",
    permissions: ["document:create", "process:handoff:send"],
    implementation: {
      verdict: "missing",
      existing: [],
      gaps: ["no document-recipient / routing concept exists"],
    },
  },
];

// ------------------------------------------------------------- join gates ----

/**
 * The pickup join gate (Deliverable 3). Both branches converge here: nothing may
 * be picked up until every applicable requirement is satisfied.
 *
 * `appliesToFileTypes` makes the gate configurable by operation type — IMP/EXP
 * carry a customs leg, TRP/HND do not. This mirrors the existing canPickup()
 * rule, which already exempts TRP/HND from the customs requirement.
 */
export const PICKUP_READINESS: GateRequirement[] = [
  {
    key: "customs_released",
    labelFr: "Mainlevée douane obtenue (BAE)",
    appliesToFileTypes: ["IMP", "EXP"],
    branch: "customs",
  },
  { key: "bon_a_delivrer", labelFr: "Bon à Délivrer obtenu", appliesToFileTypes: [], branch: "transport_readiness" },
  { key: "pre_gate", labelFr: "Autorisation Pre-Gate obtenue", appliesToFileTypes: [], branch: "transport_readiness" },
  {
    key: "bordereau_livraison",
    labelFr: "Bordereau de Livraison établi",
    appliesToFileTypes: [],
    branch: "transport_readiness",
  },
  { key: "vehicle_assigned", labelFr: "Véhicule affecté", appliesToFileTypes: [], branch: "transport_readiness" },
  { key: "driver_assigned", labelFr: "Chauffeur affecté", appliesToFileTypes: [], branch: "transport_readiness" },
];

export type PickupReadinessInput = {
  fileType: string;
  customsReleased: boolean;
  customsRequired: boolean;
  bonADelivrer: boolean;
  preGate: boolean;
  bordereauLivraison: boolean;
  vehicleAssigned: boolean;
  driverAssigned: boolean;
};

export type ReadinessResult = {
  ready: boolean;
  /** Requirement keys that are not satisfied. Empty when `ready`. */
  missing: string[];
  /** Requirement keys skipped because they do not apply to this dossier type. */
  notApplicable: string[];
};

/**
 * Evaluate the pickup join gate. PURE. Mirrors the existing canPickup() customs
 * rule and extends it with the five transport-readiness requirements.
 */
export function evaluatePickupReadiness(input: PickupReadinessInput): ReadinessResult {
  const satisfied: Record<string, boolean> = {
    customs_released: input.customsReleased || !input.customsRequired,
    bon_a_delivrer: input.bonADelivrer,
    pre_gate: input.preGate,
    bordereau_livraison: input.bordereauLivraison,
    vehicle_assigned: input.vehicleAssigned,
    driver_assigned: input.driverAssigned,
  };

  const missing: string[] = [];
  const notApplicable: string[] = [];

  for (const req of PICKUP_READINESS) {
    const applies = req.appliesToFileTypes.length === 0 || req.appliesToFileTypes.includes(input.fileType);
    if (!applies) {
      notApplicable.push(req.key);
      continue;
    }
    if (!satisfied[req.key]) missing.push(req.key);
  }

  return { ready: missing.length === 0, missing, notApplicable };
}

// --------------------------------------------------------- maker-checker ----

/**
 * Independent-review pairs (Deliverable 8). In all three, the preparer and the
 * validator must be DIFFERENT people, rejection requires a reason, and rejected
 * work returns to an explicit correction step.
 *
 * NOTE: no maker-checker separation exists in the platform today — a repo-wide
 * search finds zero code paths that check an approver differs from the preparer.
 * These are the contract Phase 5.0B must implement.
 */
export const MAKER_CHECKER_PAIRS: MakerCheckerPair[] = [
  {
    key: "customs_validation",
    preparerStep: "customs_preparation",
    validatorStep: "transit_validation",
    correctionStep: "customs_preparation",
    selfApprovalAllowed: false,
    reasonRequired: true,
  },
  {
    key: "invoice_validation",
    preparerStep: "billing_draft",
    validatorStep: "finance_invoice_validation",
    correctionStep: "billing_draft",
    selfApprovalAllowed: false,
    reasonRequired: true,
  },
  {
    key: "completeness_review",
    preparerStep: "coordinator_completeness",
    validatorStep: "am_completeness",
    correctionStep: "coordinator_completeness",
    selfApprovalAllowed: false,
    reasonRequired: true,
  },
];

// -------------------------------------------------------- client journey ----

/**
 * The customer-safe journey (Deliverable 11). Internal steps map UP to these ten
 * stages; steps with `clientStage: null` are never exposed. Nothing here reveals
 * internal validation loops, employee names, SLA thresholds, spending
 * authorisations, collection notes or customs internals.
 */
export const CLIENT_JOURNEY: { key: ClientJourneyStage; labelFr: string }[] = [
  { key: "request_received", labelFr: "Demande reçue" },
  { key: "documentation_in_preparation", labelFr: "Documentation en préparation" },
  { key: "customs_processing", labelFr: "Dédouanement en cours" },
  { key: "customs_released", labelFr: "Dédouanement obtenu" },
  { key: "transport_preparation", labelFr: "Préparation du transport" },
  { key: "pickup_completed", labelFr: "Enlèvement effectué" },
  { key: "in_transit", labelFr: "En transit" },
  { key: "delivered", labelFr: "Livré" },
  { key: "invoice_issued", labelFr: "Facture émise" },
  { key: "payment_closure", labelFr: "Paiement et clôture" },
];

// -------------------------------------------------------------- lookups ----

export const PROCESS_STEP_COUNT = 26;

export const STEP_KEYS = EFFITRANS_PROCESS.map((s) => s.key);

const BY_KEY = new Map<string, ProcessStep>(EFFITRANS_PROCESS.map((s) => [s.key, s]));
const BY_NUMBER = new Map<number, ProcessStep>(EFFITRANS_PROCESS.map((s) => [s.stepNumber, s]));
const ACTIVITY_BY_KEY = new Map<string, ProcessActivity>(PARALLEL_ACTIVITIES.map((a) => [a.key, a]));

export function getStep(key: string): ProcessStep | null {
  return BY_KEY.get(key) ?? null;
}

export function getStepByNumber(n: number): ProcessStep | null {
  return BY_NUMBER.get(n) ?? null;
}

export function getActivity(key: string): ProcessActivity | null {
  return ACTIVITY_BY_KEY.get(key) ?? null;
}

/** Every step (numbered or parallel activity) owned by a department — its queue. */
export function stepsForDepartment(dept: ProcessDepartment): (ProcessStep | ProcessActivity)[] {
  return [
    ...EFFITRANS_PROCESS.filter((s) => s.department === dept),
    ...PARALLEL_ACTIVITIES.filter((a) => a.department === dept),
  ];
}

export function stepsInBranch(group: ParallelGroup): (ProcessStep | ProcessActivity)[] {
  return [
    ...EFFITRANS_PROCESS.filter((s) => s.parallelGroup === group),
    ...PARALLEL_ACTIVITIES.filter((a) => a.parallelGroup === group),
  ];
}

/**
 * Bridge to the five legacy UI department keys (lib/files/lifecycle.ts). The
 * official taxonomy is finer-grained; this collapses it so existing department
 * workspaces keep working while Phase 5.0C builds the official queues.
 */
export const LEGACY_DEPT: Record<ProcessDepartment, string> = {
  cotation: "opening",
  operations: "opening",
  account_management: "documentation",
  coordination: "documentation",
  transit: "customs",
  customs_declaration: "customs",
  finance_customs: "customs",
  customs_field: "customs",
  transport: "transport",
  pickup: "transport",
  billing: "finance",
  finance: "finance",
  administration: "archive",
  courier: "archive",
  collections: "finance",
};

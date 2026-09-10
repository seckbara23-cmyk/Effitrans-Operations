/**
 * Process engine — evidence checker (Phase 5.0B). PURE. No I/O, no uploads.
 * ---------------------------------------------------------------------------
 * The engine REFERENCES evidence; it never creates a second document system.
 * Everything here reads a snapshot of the EXISTING records — document,
 * customs_record, transport_record, invoice, payment — and answers, per official
 * document key from the 5.0A registry: is it satisfied, missing, invalid, still
 * under review, or not visible to this caller?
 *
 * Two rules worth stating explicitly:
 *   * A document only SATISFIES when it is VERIFIED (or consumed as evidence;
 *     legacy rows say APPROVED). An uploaded-but-unreviewed
 *     document is `pending_review`, never `satisfied` — a step cannot complete on
 *     the strength of a document nobody has checked.
 *   * Nothing is ever inferred from free text. A BAE reference is a reference; an
 *     empty string is not a BAE.
 */
import { isVerified } from "@/lib/documents/doctrine";
import { DOCUMENT_MAPPINGS, mapDocument } from "../documents";
import { getNode } from "./state";
import { amAssignmentRequiredForFileType } from "../applicability";

export type EvidenceStatus =
  | "satisfied"
  | "missing"
  | "invalid"
  | "pending_review"
  /** The caller lacks the module permission to even see this evidence. */
  | "unauthorized";

export type EvidenceItem = {
  /** Official document key from the registry (e.g. BON_A_ENLEVER). */
  key: string;
  labelFr: string;
  status: EvidenceStatus;
  /** Why it is not satisfied. Never contains document contents. */
  detail?: string;
};

/**
 * A snapshot of the existing records for one dossier. Assembled by the server
 * service with bounded batch reads (no N+1) and handed to this pure function.
 */
export type EvidenceSnapshot = {
  fileType: string;
  /**
   * UAT-STEP12-FIELD-AGENT-01 — the Agent de Terrain named on step 13
   * (`customs_field_clearance.assigned_user_id`), which is step 12's ratified
   * output. `undefined` where the caller did not project it.
   */
  fieldAgentAssignedUserId?: string | null;
  /**
   * OPS-SERVICE-SCOPE-01 — the services Effitrans provides on this dossier, as
   * the operator chose them. `undefined` means the column was not projected
   * (schema 138/139); `null` means it exists and nobody chose. Both are « never
   * recorded » and both fall through to type derivation.
   */
  services?: readonly string[] | null;
  /** Which modules the caller may read. An unreadable module yields `unauthorized`. */
  access: {
    documents: boolean;
    customs: boolean;
    transport: boolean;
    finance: boolean;
  };
  /** One entry per document on the dossier. */
  documents: { typeCode: string; status: string }[];
  customs: {
    required: boolean;
    status: string;
    baeReference: string | null;
    declarationNumber: string | null;
    externalRef: string | null;
    /**
     * MAYA-P1.11 — when the Déclarant recorded the rattachement in GAINDE /
     * ORBUS. The GOVERNED fact of step 11: attributed, dated, systems named.
     * `undefined` where the column was not projected.
     */
    attachmentCompletedAt?: string | null;
  } | null;
  transport: {
    status: string;
    vehiclePlate: string | null;
    driverName: string | null;
    driverUserId: string | null;
  } | null;
  invoices: { status: string; balance: number }[];
  /**
   * OPS-OWNERSHIP-01 — the GOVERNED designation of the Responsable client.
   *
   * Both halves are carried on purpose. `accountManagerId` is the dossier's
   * current commercial owner; `governedUserIds` are the users a COMMERCIAL_OWNER
   * `assignment_event` has actually named. The evidence is satisfied only when
   * the current owner appears in that immutable history — so the column alone
   * can never satisfy step 2, and a value that did not arrive through
   * `assign_commercial_owner` would not either.
   *
   * Optional for the same reason as `declaredAbsences`: display-only
   * projections that omit it show the stricter view, and authorise nothing.
   */
  commercialOwner?: {
    accountManagerId: string | null;
    governedUserIds: string[];
  };
  /**
   * C-3 — evidence keys DECLARED inapplicable to this dossier, with their motif.
   * A declaration satisfies exactly the key it names and fabricates no document.
   *
   * OPTIONAL by type, ALWAYS populated by the two paths that decide anything:
   * `loadProcessSnapshot` (every gate, every submit) and the queue service
   * (every queue/My Work row). Display-only projections that omit it simply show
   * the stricter, undeclared view — they authorise nothing, so they cannot
   * disagree with the engine about what is allowed, only about what is pretty.
   * Recorded as bounded follow-up rather than left implicit.
   */
  declaredAbsences?: { key: string; reason: string }[];
};

import { absenceLabelFr, isDeclarableEvidence } from "../evidence-absence";

const nonEmpty = (v: string | null | undefined): boolean => typeof v === "string" && v.trim().length > 0;

/**
 * A VERIFIED document of this type exists.
 *
 * Same WES-4/WES-5 correction as the transport POD gate: the canonical status
 * is VERIFIED (legacy rows say APPROVED) and a document consumed as evidence
 * reads CONSUMED_AS_EVIDENCE. Testing the legacy name alone meant every
 * document-backed step stopped being satisfiable the moment WES-4 landed.
 */
function approvedDoc(snap: EvidenceSnapshot, typeCode: string): boolean {
  return snap.documents.some((d) => d.typeCode === typeCode && isVerified(d.status));
}

/** A document of this type exists but has not been approved yet. */
function awaitingReview(snap: EvidenceSnapshot, typeCode: string): boolean {
  return snap.documents.some(
    (d) => d.typeCode === typeCode && (d.status === "UPLOADED" || d.status === "PENDING_REVIEW"),
  );
}

function rejectedDoc(snap: EvidenceSnapshot, typeCode: string): boolean {
  return snap.documents.some((d) => d.typeCode === typeCode && (d.status === "REJECTED" || d.status === "EXPIRED"));
}

/**
 * Resolve ONE official document key against the existing records.
 *
 * Keys whose document type does not exist yet (Phase 5.0D adds ten of them)
 * resolve to `missing` with an explicit detail — never to `satisfied`. The engine
 * must not pretend an artefact is present because the platform cannot store it.
 */
export function checkEvidence(key: string, snap: EvidenceSnapshot): EvidenceItem {
  const mapping = DOCUMENT_MAPPINGS.find((d) => d.key === key);
  const labelFr = mapping?.labelFr ?? key;

  // C-3 — a DECLARED ABSENCE satisfies this one key, on this one dossier. The
  // declarable set is closed (evidence-absence.ts + migration 123 CHECK), so a
  // declaration can only exist for evidence the business ratified as
  // conditional. The label carries the motif, so a later reviewer sees WHY it
  // was waived rather than an unexplained pass.
  const declared = (snap.declaredAbsences ?? []).find((d) => d.key === key);
  if (declared && isDeclarableEvidence(key)) {
    return { key, labelFr, status: "satisfied", detail: absenceLabelFr(declared.reason) };
  }

  // OPS-OWNERSHIP-01 — the designation of the Responsable client (step 2).
  //
  // Ratified K3: the proof is the governed mechanism plus its immutable
  // history, "not merely a nullable UI value". So BOTH must hold — the dossier
  // names a current Account Manager, AND a COMMERCIAL_OWNER assignment_event
  // names that same user. A column carrying a value no event ever recorded is
  // reported missing, which is what makes `assign_commercial_owner` the only
  // way to satisfy this step rather than merely the only writer today.
  //
  // Inapplicable types never reach here: the registry node's requiredDocuments
  // are filtered by `amAssignmentRequiredForFileType` before evaluation, so for
  // TRP/HND this key is not requested at all (deferred K4).
  if (key === "ACCOUNT_MANAGER_ASSIGNMENT") {
    const co = snap.commercialOwner;
    // Absent projection = stricter view. Never satisfied by omission.
    if (!co) return { key, labelFr, status: "missing", detail: "no_assignment_data" };
    if (!nonEmpty(co.accountManagerId)) {
      return { key, labelFr, status: "missing", detail: "no_account_manager" };
    }
    if (!co.governedUserIds.includes(co.accountManagerId as string)) {
      return { key, labelFr, status: "missing", detail: "no_governed_assignment" };
    }
    return { key, labelFr, status: "satisfied" };
  }

  // Structured records, not uploads.
  if (key === "CUSTOMS_DOSSIER") {
    if (!snap.access.customs) return { key, labelFr, status: "unauthorized" };
    if (!snap.customs) return { key, labelFr, status: "missing", detail: "no_customs_record" };
    return { key, labelFr, status: "satisfied" };
  }

  if (key === "GAINDE_DECLARATION_REFERENCE") {
    if (!snap.access.customs) return { key, labelFr, status: "unauthorized" };
    const ref = snap.customs?.externalRef ?? snap.customs?.declarationNumber ?? null;
    // Never infer from free text: an empty/whitespace reference is NOT a reference.
    return nonEmpty(ref)
      ? { key, labelFr, status: "satisfied" }
      : { key, labelFr, status: "missing", detail: "no_gainde_reference" };
  }

  // GAINDE_SUBMISSION_EVIDENCE — A RECORDED ACT, or a document, not ONLY a document.
  //
  // UAT-STEP11-RECONCILE-01. This key fell through to the catalogue branch
  // below, so the only thing that could satisfy it was a VERIFIED upload of a
  // `GAINDE_SUBMISSION_EVIDENCE` document. But the ratified proof of step 11 is
  // the Déclarant's own rattachement: MAYA-P1.11 built it, migration
  // 20260828000001 carries it, DEC-C40's own wording says « migration
  // 20260828000001 y porte le fait », and that suite states the rule in as many
  // words — « a screenshot is NEVER a precondition ».
  //
  // So the platform held two predicates for one step and checked the other one.
  // On EFT-IMP-2026-00011 the Déclarant recorded GAINDE + ORBUS at 21:38, the
  // fact was persisted and attributed — and the dossier went on saying
  // « Action requise : Preuve d'introduction des documents dans GAINDE »,
  // `submitStep` refused `evidence_missing`, and the reconciler refused for the
  // same reason, so step 11 could never close by any route.
  //
  // STRICTLY WIDENING, and deliberately so: the gate stays HARD (with neither
  // the act nor a document, step 11 still cannot complete, and steps 12-13 still
  // rest on real proof), while the upload remains a legitimate way to satisfy it
  // — which is what keeps « attachable through the ordinary document path » true
  // and strands nobody who already took that route.
  if (key === "GAINDE_SUBMISSION_EVIDENCE") {
    if (snap.access.customs && nonEmpty(snap.customs?.attachmentCompletedAt ?? null)) {
      return { key, labelFr, status: "satisfied", detail: "rattachement_recorded" };
    }
    // No recorded act — fall through to the document catalogue below, which is
    // exactly what every dossier satisfied by an upload already relies on.
  }

  // FIELD_AGENT_ASSIGNMENT — a GOVERNED ASSIGNMENT, never an upload.
  //
  // UAT-STEP12-FIELD-AGENT-01. Step 12 is « suivre le dossier en douane ET
  // affecter l'Agent de Terrain », and the registry has always said so:
  // `requiredEvidence: ["field_agent_id"]`, `completionRule:
  // "field_agent_assigned"`. Neither was ever enforced — `evaluateStepEvidence`
  // reads `requiredDocuments`, which was empty — so « Terminer » closed step 12
  // with nobody named and opened step 13 unassigned. The governed
  // responsibility of the step was silently skippable.
  //
  // The fact is `customs_field_clearance.assigned_user_id`, written by ONE
  // writer (`assignTransitStep`) which checks Transit custody, the assigner's
  // authority, and that the assignee is an ACTIVE, same-tenant, TRANSIT-mapped
  // user — then audits before AND after. Nothing here re-implements any of
  // that; this only asks whether that writer has run.
  //
  // Ratified 2026-09-09 (UAT-STEP12-FIELD-AGENT-01 J2) and DELIBERATELY NARROW:
  // `requiredEvidence` stays documentary for the other 25 steps. Turning it
  // into a gate everywhere would convert ~20 unexamined strings into blockers,
  // which is exactly the leniency doctrine's warning.
  if (key === "FIELD_AGENT_ASSIGNMENT") {
    if (!snap.access.customs) return { key, labelFr, status: "unauthorized" };
    return nonEmpty(snap.fieldAgentAssignedUserId ?? null)
      ? { key, labelFr, status: "satisfied", detail: "field_agent_assigned" }
      : { key, labelFr, status: "missing", detail: "no_field_agent" };
  }

  // CUSTOMS_RELEASE — the finalized mainlevée, a GOVERNED FACT, never an upload.
  //
  // STEP13-COMPLETION-01. Step 13 is « obtenir le Bon à Enlever ET lever le
  // dossier », and the registry has always said so: `completionRule:
  // "bae_obtained_and_customs_released"`. Only the first half was enforced —
  // `BON_A_ENLEVER` asks whether a BAE REFERENCE exists — so on
  // EFT-IMP-2026-00011, the moment the field agent recorded the BAE, « Terminer »
  // was offered and `submitStep` would have accepted it: with the Chef de
  // Transit's verification still PENDING and customs still INSPECTION.
  //
  // And an early completion is not merely premature, it is IRREVERSIBLE through
  // the UI: `customs.release` is gated on this step, a COMPLETED step answers
  // `step_closed`, so `finalizeTransitRelease` could never record the release,
  // customs could never become RELEASED, and the pickup gate could never open.
  //
  // So the release is its own key. `BON_A_ENLEVER` keeps meaning « the BAE was
  // recorded » and this means « the release was finalized »: two governed facts,
  // two sentences an operator can act on. ONLY `status === "RELEASED"` satisfies
  // it — an approval PENDING, REJECTED or even APPROVED-but-not-finalized is not a
  // release. `recordCustomsRelease` is the one writer of that status, and it
  // already refuses without the Chef's APPROVED verdict.
  if (key === "CUSTOMS_RELEASE") {
    if (!snap.access.customs) return { key, labelFr, status: "unauthorized" };
    if (!snap.customs) return { key, labelFr, status: "missing", detail: "no_customs_record" };
    return snap.customs.status === "RELEASED"
      ? { key, labelFr, status: "satisfied", detail: "customs_released" }
      : { key, labelFr, status: "missing", detail: "customs_not_released" };
  }

  if (key === "BON_A_ENLEVER") {
    if (!snap.access.customs) return { key, labelFr, status: "unauthorized" };
    if (!snap.customs) return { key, labelFr, status: "missing", detail: "no_customs_record" };
    return nonEmpty(snap.customs.baeReference)
      ? { key, labelFr, status: "satisfied" }
      : { key, labelFr, status: "missing", detail: "no_bae_reference" };
  }

  if (key === "FINAL_INVOICE") {
    if (!snap.access.finance) return { key, labelFr, status: "unauthorized" };
    const issued = snap.invoices.filter((i) => i.status !== "DRAFT" && i.status !== "VOID");
    if (issued.length > 0) return { key, labelFr, status: "satisfied" };
    const draft = snap.invoices.some((i) => i.status === "DRAFT");
    return draft
      ? { key, labelFr, status: "pending_review", detail: "invoice_not_validated" }
      : { key, labelFr, status: "missing", detail: "no_invoice" };
  }

  // Everything else is a DOCUMENT in the existing catalog.
  if (!snap.access.documents) return { key, labelFr, status: "unauthorized" };

  const typeCode = mapping?.typeCode ?? null;
  if (!typeCode) {
    // No document type exists for this artefact yet (Phase 5.0D).
    return { key, labelFr, status: "missing", detail: "document_type_not_in_catalog" };
  }

  if (approvedDoc(snap, typeCode)) return { key, labelFr, status: "satisfied" };
  if (awaitingReview(snap, typeCode)) return { key, labelFr, status: "pending_review", detail: "awaiting_approval" };
  if (rejectedDoc(snap, typeCode)) return { key, labelFr, status: "invalid", detail: "rejected_or_expired" };
  return { key, labelFr, status: "missing", detail: "not_uploaded" };
}

export type StepEvidence = {
  items: EvidenceItem[];
  satisfied: string[];
  missing: string[];
  invalid: string[];
  pendingReview: string[];
  unauthorized: string[];
  /** True when nothing is missing/invalid AND nothing is still under review. */
  complete: boolean;
};

/**
 * Evaluate every document a registry step requires.
 *
 * `unauthorized` items do NOT count as satisfied and do NOT block: the caller
 * simply cannot see them, so the engine reports the fact rather than guessing.
 * A step can only COMPLETE when a caller who CAN see the evidence confirms it.
 */
export function evaluateStepEvidence(stepKey: string, snap: EvidenceSnapshot): StepEvidence {
  const node = getNode(stepKey);
  // OPS-OWNERSHIP-01 — evidence whose applicability is narrower than its step's.
  // `operations_intake` applies to every dossier type, but whether a TRP/HND
  // dossier has a Responsable client at all is deferred decision K4. Filtering
  // the KEY (rather than skipping the step) leaves those dossiers exactly as
  // they behave today and keeps K4 undecided.
  const keys = (node?.requiredDocuments ?? []).filter(
    (k) => k !== "ACCOUNT_MANAGER_ASSIGNMENT" || amAssignmentRequiredForFileType(snap.fileType),
  );
  const items = keys.map((k) => checkEvidence(k, snap));

  const pick = (s: EvidenceStatus) => items.filter((i) => i.status === s).map((i) => i.key);
  const missing = pick("missing");
  const invalid = pick("invalid");
  const pendingReview = pick("pending_review");

  return {
    items,
    satisfied: pick("satisfied"),
    missing,
    invalid,
    pendingReview,
    unauthorized: pick("unauthorized"),
    complete: missing.length === 0 && invalid.length === 0 && pendingReview.length === 0,
  };
}

/** Derived: the dossier has issued invoices and none owe a balance. */
export function fullyPaid(snap: EvidenceSnapshot): boolean {
  const issued = snap.invoices.filter((i) => i.status !== "DRAFT" && i.status !== "VOID");
  return issued.length > 0 && issued.every((i) => i.balance <= 0);
}

/** Derived: an APPROVED delivery note (POD) exists on the dossier. */
export function podReceived(snap: EvidenceSnapshot): boolean {
  return approvedDoc(snap, mapDocument("SIGNED_DELIVERY_NOTE").typeCode!);
}

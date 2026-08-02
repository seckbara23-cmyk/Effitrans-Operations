import "server-only";

/**
 * HR-2 — the Employee Timeline ledger, write + read side. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * `hr_employee_event` is append-only (prevent_mutation). Emission is MANDATORY
 * for HR domain writes (WES-9A discipline): callers treat a returned error as
 * an abort signal and COMPENSATE their domain write — PostgREST offers no
 * cross-call transaction, so the pattern here is domain-write → emit →
 * compensate-on-failure, and every action documents its compensation.
 *
 * C3 DISCIPLINE (ratified §7): payloads carry kinds, codes and dates — never a
 * salary, never an identifier value. The projection renders exactly what the
 * ledger holds; users never edit the timeline.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export type HrEventKind =
  | "created"
  | "assignment_changed"
  | "status_changed"
  | "account_linked"
  | "account_unlinked"
  | "document_added"
  | "contract_added"
  | "contract_verified"
  | "contract_ended"
  | "onboarding_created"
  | "onboarding_started"
  | "onboarding_item_completed"
  | "onboarding_completed"
  | "onboarding_cancelled"
  | "asset_assigned"
  | "asset_returned"
  | "leave_requested"
  | "leave_approved"
  | "leave_refused"
  | "leave_cancelled"
  // HR-6. Emitted by the transactional RPCs, never by draft edits: a review the
  // employee never saw does not belong in the narrative of their employment.
  | "performance_cycle_opened"
  | "objective_assigned"
  | "self_assessment_submitted"
  | "manager_review_submitted"
  | "performance_review_finalized"
  | "performance_review_acknowledged"
  | "training_assigned"
  | "training_completed"
  | "certificate_recorded";

/** French labels for the projection — one entry per kind, exhaustively. */
export const HR_EVENT_LABEL_FR: Record<HrEventKind, string> = {
  created: "Employé créé",
  assignment_changed: "Affectation modifiée",
  status_changed: "Statut d'emploi modifié",
  account_linked: "Compte de connexion lié",
  account_unlinked: "Compte de connexion délié",
  document_added: "Document ajouté au dossier",
  contract_added: "Contrat enregistré",
  contract_verified: "Contrat vérifié (visa à quatre yeux)",
  contract_ended: "Contrat terminé",
  onboarding_created: "Dossier d'intégration créé",
  onboarding_started: "Intégration démarrée",
  onboarding_item_completed: "Élément d'intégration complété",
  onboarding_completed: "Intégration terminée",
  onboarding_cancelled: "Intégration annulée",
  asset_assigned: "Équipement attribué",
  asset_returned: "Équipement restitué",
  leave_requested: "Congé demandé",
  leave_approved: "Congé approuvé",
  leave_refused: "Congé refusé",
  leave_cancelled: "Congé annulé",
  performance_cycle_opened: "Cycle d'évaluation ouvert",
  objective_assigned: "Objectif assigné",
  self_assessment_submitted: "Auto-évaluation soumise",
  manager_review_submitted: "Évaluation du manager soumise",
  performance_review_finalized: "Évaluation finalisée",
  performance_review_acknowledged: "Évaluation accusée de réception",
  training_assigned: "Formation assignée",
  training_completed: "Formation terminée",
  certificate_recorded: "Certificat enregistré",
};

export type EmitInput = {
  tenantId: string;
  employeeId: string;
  kind: HrEventKind;
  actorId: string | null;
  /** C3-free payload — kinds/codes/dates only. */
  payload?: Record<string, unknown>;
};

/** Append one event. Returns false on failure — the CALLER must compensate. */
export async function emitHrEvent(input: EmitInput): Promise<boolean> {
  const supabase = getAdminSupabaseClient();
  const { error } = await supabase.from("hr_employee_event").insert({
    tenant_id: input.tenantId,
    employee_id: input.employeeId,
    event_kind: input.kind,
    actor_id: input.actorId,
    payload: input.payload ?? {},
  });
  return !error;
}

export type TimelineEntry = {
  id: string;
  event_kind: string;
  occurred_at: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
};

/** The projection — always derived from the ledger, newest first. */
export async function getEmployeeTimeline(tenantId: string, employeeId: string): Promise<TimelineEntry[]> {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_employee_event")
    .select("id, event_kind, occurred_at, actor_id, payload")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`[hr] timeline read failed: ${error.message}`);
  return (data ?? []) as TimelineEntry[];
}

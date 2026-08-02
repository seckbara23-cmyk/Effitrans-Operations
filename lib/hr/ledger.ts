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
  | "contract_ended";

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

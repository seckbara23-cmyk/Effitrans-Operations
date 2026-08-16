import "server-only";

/**
 * HR-8A — Offboarding reads. SERVER-ONLY. Dark foundation: no UI consumes
 * these yet (HR-8B activates the « Départs » workspace).
 *
 * Writes live in ./offboarding-actions.ts and go through the migration-111
 * RPCs (domain write + ledger event in one transaction, INV-7 inside).
 *
 * THE GATES ARE DERIVED, NEVER STORED (audit §5): equipment custody and the
 * termination-document list are read live from their authoritative tables —
 * the completion RPC re-checks them database-side (I-8.2), so these reads are
 * display, not enforcement.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";
import { missingTerminationDocuments } from "./employee-file";

type Tbl = Database["public"]["Tables"];
export type OffboardingCase = Tbl["hr_offboarding_case"]["Row"];
export type OffboardingItem = Tbl["hr_offboarding_item"]["Row"];
export type ChecklistTemplate = Tbl["hr_checklist_template"]["Row"];
export type EquipmentAssignment = Tbl["hr_equipment_assignment"]["Row"];

export const OFFBOARDING_STATUS_FR: Record<string, string> = {
  OPEN: "Ouvert", IN_PROGRESS: "En cours",
  COMPLETED: "Clôturé", CANCELLED: "Annulé",
};

/** Templates of the OFFBOARDING kind only (I-8.10). */
export async function listOffboardingTemplates(tenantId: string): Promise<ChecklistTemplate[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_checklist_template").select("*")
    .eq("tenant_id", tenantId).eq("is_active", true).eq("kind", "OFFBOARDING").order("label_fr");
  if (error) throw new Error(`[hr] offboarding templates read failed: ${error.message}`);
  return data ?? [];
}

export async function listOffboardingCases(tenantId: string): Promise<OffboardingCase[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_offboarding_case").select("*")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw new Error(`[hr] offboarding cases read failed: ${error.message}`);
  return data ?? [];
}

/** The employee's live departure case (OPEN/IN_PROGRESS), or null. */
export async function getLiveOffboardingCase(tenantId: string, employeeId: string): Promise<OffboardingCase | null> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_offboarding_case").select("*")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId)
    .in("status", ["OPEN", "IN_PROGRESS"]).maybeSingle();
  if (error) throw new Error(`[hr] live offboarding case read failed: ${error.message}`);
  return data ?? null;
}

export async function listOffboardingItems(tenantId: string, caseId: string): Promise<OffboardingItem[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_offboarding_item").select("*")
    .eq("tenant_id", tenantId).eq("case_id", caseId).order("position");
  if (error) throw new Error(`[hr] offboarding items read failed: ${error.message}`);
  return data ?? [];
}

export type OffboardingGates = {
  /** Open custody rows — a non-empty list BLOCKS completion (freeze-ratified). */
  openCustody: EquipmentAssignment[];
  /** Missing required_for_termination labels — blocks the TERMINATED transition itself. */
  missingDocuments: string[];
  /** Contracts not ENDED — ADVISORY (RQ-8.4), never a blocker here. */
  contractsNotEnded: number;
  /** The 8.1A handoff state — ADVISORY prompt (RQ-8.3), never executed by HR. */
  account: { linked: boolean; status: string | null };
};

/**
 * The derived clearance gates for one employee (audit §5). Display only:
 * hr_complete_offboarding re-derives the blocking facts inside its own
 * transaction — this read can be stale, the gate cannot.
 */
export async function offboardingGates(tenantId: string, employeeId: string): Promise<OffboardingGates> {
  const s = getAdminSupabaseClient();
  const [custody, missing, contracts, emp] = await Promise.all([
    s.from("hr_equipment_assignment").select("*")
      .eq("tenant_id", tenantId).eq("employee_id", employeeId)
      .is("returned_on", null).order("assigned_on"),
    missingTerminationDocuments(tenantId, employeeId),
    s.from("employment_contract").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("employee_id", employeeId).neq("status", "ENDED"),
    s.from("employee").select("linked_app_user_id")
      .eq("tenant_id", tenantId).eq("id", employeeId).maybeSingle(),
  ]);
  if (custody.error) throw new Error(`[hr] custody gate read failed: ${custody.error.message}`);

  let accountStatus: string | null = null;
  const linkedId = emp.data?.linked_app_user_id ?? null;
  if (linkedId) {
    const { data: account } = await s.from("app_user").select("status")
      .eq("tenant_id", tenantId).eq("id", linkedId).maybeSingle();
    accountStatus = account?.status ?? null;
  }
  return {
    openCustody: custody.data ?? [],
    missingDocuments: missing,
    contractsNotEnded: contracts.count ?? 0,
    account: { linked: linkedId !== null, status: accountStatus },
  };
}

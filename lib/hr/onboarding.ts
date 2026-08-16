import "server-only";

/**
 * HR-4 — Onboarding & Equipment reads. SERVER-ONLY.
 * Writes live in ./onboarding-actions.ts and go through the migration-76 RPCs
 * (ADR-HR2-01 hardening: domain write + ledger event in one transaction).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
export type OnboardingCase = Tbl["hr_onboarding_case"]["Row"];
export type OnboardingItem = Tbl["hr_onboarding_item"]["Row"];
export type ChecklistTemplate = Tbl["hr_checklist_template"]["Row"];
export type ProvisioningRequest = Tbl["hr_provisioning_request"]["Row"];
export type Equipment = Tbl["hr_equipment"]["Row"];
export type EquipmentType = Tbl["hr_equipment_type"]["Row"];
export type EquipmentAssignment = Tbl["hr_equipment_assignment"]["Row"];

export const ONBOARDING_STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon", READY: "Prêt", IN_PROGRESS: "En cours",
  COMPLETED: "Terminé", CANCELLED: "Annulé",
};
export const ITEM_STATUS_FR: Record<string, string> = {
  PENDING: "À faire", DONE: "Fait", NOT_APPLICABLE: "Sans objet",
};
export const RETURN_OUTCOME_FR: Record<string, string> = {
  RETURNED: "Restitué", DAMAGED: "Restitué endommagé",
  LOST: "Perdu", NOT_RETURNED: "Non restitué",
};
export const LIFECYCLE_FR: Record<string, string> = {
  IN_STOCK: "En stock", ASSIGNED: "Attribué", IN_REPAIR: "En réparation",
  RETIRED: "Retiré", LOST: "Perdu",
};

export async function listChecklistTemplates(tenantId: string): Promise<ChecklistTemplate[]> {
  const s = getAdminSupabaseClient();
  // I-8.10: the template engine is shared; this surface is the ONBOARDING kind.
  const { data, error } = await s.from("hr_checklist_template").select("*")
    .eq("tenant_id", tenantId).eq("is_active", true).eq("kind", "ONBOARDING").order("label_fr");
  if (error) throw new Error(`[hr] templates read failed: ${error.message}`);
  return data ?? [];
}

export async function listOnboardingCases(tenantId: string): Promise<OnboardingCase[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_onboarding_case").select("*")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw new Error(`[hr] onboarding cases read failed: ${error.message}`);
  return data ?? [];
}

/** The employee's live case (DRAFT/READY/IN_PROGRESS), or null. */
export async function getLiveOnboardingCase(tenantId: string, employeeId: string): Promise<OnboardingCase | null> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_onboarding_case").select("*")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId)
    .in("status", ["DRAFT", "READY", "IN_PROGRESS"]).maybeSingle();
  if (error) throw new Error(`[hr] live case read failed: ${error.message}`);
  return data ?? null;
}

export async function listOnboardingItems(tenantId: string, caseId: string): Promise<OnboardingItem[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_onboarding_item").select("*")
    .eq("tenant_id", tenantId).eq("case_id", caseId).order("position");
  if (error) throw new Error(`[hr] onboarding items read failed: ${error.message}`);
  return data ?? [];
}

export async function listProvisioningRequests(tenantId: string, caseId: string): Promise<ProvisioningRequest[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_provisioning_request").select("*")
    .eq("tenant_id", tenantId).eq("case_id", caseId).order("requested_at");
  if (error) throw new Error(`[hr] provisioning read failed: ${error.message}`);
  return data ?? [];
}

export async function listEquipmentTypes(tenantId: string): Promise<EquipmentType[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_equipment_type").select("*")
    .eq("tenant_id", tenantId).eq("is_active", true).order("label_fr");
  if (error) throw new Error(`[hr] equipment types read failed: ${error.message}`);
  return data ?? [];
}

export async function listEquipment(tenantId: string): Promise<Equipment[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_equipment").select("*")
    .eq("tenant_id", tenantId).order("asset_tag");
  if (error) throw new Error(`[hr] equipment read failed: ${error.message}`);
  return data ?? [];
}

/** Custody history for one employee (open first, then closed, newest first). */
export async function listEmployeeCustody(tenantId: string, employeeId: string): Promise<EquipmentAssignment[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_equipment_assignment").select("*")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId)
    .order("assigned_on", { ascending: false });
  if (error) throw new Error(`[hr] custody read failed: ${error.message}`);
  const rows = data ?? [];
  return [...rows.filter((r) => r.returned_on === null), ...rows.filter((r) => r.returned_on !== null)];
}

/** Every open custody row in the tenant — the "assets currently assigned" surface. */
export async function listOpenCustody(tenantId: string): Promise<EquipmentAssignment[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_equipment_assignment").select("*")
    .eq("tenant_id", tenantId).is("returned_on", null).order("assigned_on");
  if (error) throw new Error(`[hr] open custody read failed: ${error.message}`);
  return data ?? [];
}

export type HrOperationsCounts = {
  activeCases: number;
  overdueItems: number;
  assetsAssigned: number;
  assetsAwaitingReturn: number;
};

/** Dashboard counters for the HR-4 surfaces. */
export async function hrOperationsCounts(tenantId: string): Promise<HrOperationsCounts> {
  const s = getAdminSupabaseClient();
  const head = { count: "exact" as const, head: true };
  const today = new Date().toISOString().slice(0, 10);
  const [cases, overdue, assigned, awaiting] = await Promise.all([
    s.from("hr_onboarding_case").select("id", head).eq("tenant_id", tenantId).in("status", ["READY", "IN_PROGRESS"]),
    s.from("hr_onboarding_item").select("id", head).eq("tenant_id", tenantId).eq("status", "PENDING").lt("due_date", today),
    s.from("hr_equipment_assignment").select("id", head).eq("tenant_id", tenantId).is("returned_on", null),
    s.from("hr_equipment_assignment").select("id", head).eq("tenant_id", tenantId).is("returned_on", null).lt("expected_return_date", today),
  ]);
  return {
    activeCases: cases.count ?? 0,
    overdueItems: overdue.count ?? 0,
    assetsAssigned: assigned.count ?? 0,
    assetsAwaitingReturn: awaiting.count ?? 0,
  };
}

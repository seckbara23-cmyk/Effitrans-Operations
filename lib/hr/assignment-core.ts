import "server-only";

/**
 * HR-A2 — assignment-target validation. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The ONE gate proving that every referenced assignment target belongs to the
 * caller's tenant and is active. Shared by the assignment engine
 * (setEmployeeAssignment) and employee creation's initial placement.
 *
 * Why app-side and not a migration: employee_assignment's target columns are
 * deliberately PLAIN FKs (no tenant-match trigger), and the table has NO RLS
 * write policy — authenticated users cannot write it at all. The only write
 * paths are the two server actions that call this validator, so this IS the
 * tenant/active boundary for assignment targets; tests pin that both writers
 * invoke it before any insert. A database trigger would require a migration
 * for a path no browser can reach.
 *
 * Every check reads by (tenant_id, id): a cross-tenant id and a nonexistent id
 * are indistinguishable on purpose (no cross-tenant existence oracle).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export type AssignmentTargets = {
  orgUnitId?: string | null;
  positionId?: string | null;
  workLocationId?: string | null;
  managerEmployeeId?: string | null;
};

export type AssignmentTargetError =
  | "invalid_unit"
  | "inactive_unit"
  | "invalid_position"
  | "inactive_position"
  | "invalid_location"
  | "inactive_location"
  | "invalid_manager";

/** French messages for creation-flow surfacing (the panel maps codes itself). */
export const ASSIGNMENT_TARGET_ERROR_FR: Record<AssignmentTargetError, string> = {
  invalid_unit: "L'unité d'organisation indiquée est introuvable.",
  inactive_unit: "L'unité d'organisation indiquée est désactivée — réactivez-la ou choisissez-en une autre.",
  invalid_position: "Le poste indiqué est introuvable.",
  inactive_position: "Le poste indiqué est désactivé.",
  invalid_location: "Le site indiqué est introuvable.",
  inactive_location: "Le site indiqué est désactivé.",
  invalid_manager: "Le responsable indiqué est introuvable.",
};

/**
 * Validate every provided target against the tenant. Returns the FIRST error
 * code, or null when all provided targets are legitimate. Absent/null targets
 * are legitimately optional and never checked (positions and sites are created
 * progressively — HR-A2 §6).
 */
export async function validateAssignmentTargets(
  tenantId: string,
  targets: AssignmentTargets,
): Promise<AssignmentTargetError | null> {
  const admin = getAdminSupabaseClient();

  if (targets.orgUnitId) {
    const { data } = await admin
      .from("hr_org_unit")
      .select("id, is_active")
      .eq("tenant_id", tenantId)
      .eq("id", targets.orgUnitId)
      .maybeSingle();
    if (!data) return "invalid_unit";
    if (!data.is_active) return "inactive_unit";
  }

  if (targets.positionId) {
    const { data } = await admin
      .from("hr_position")
      .select("id, is_active")
      .eq("tenant_id", tenantId)
      .eq("id", targets.positionId)
      .maybeSingle();
    if (!data) return "invalid_position";
    if (!data.is_active) return "inactive_position";
  }

  if (targets.workLocationId) {
    const { data } = await admin
      .from("hr_work_location")
      .select("id, is_active")
      .eq("tenant_id", tenantId)
      .eq("id", targets.workLocationId)
      .maybeSingle();
    if (!data) return "invalid_location";
    if (!data.is_active) return "inactive_location";
  }

  if (targets.managerEmployeeId) {
    const { data } = await admin
      .from("employee")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", targets.managerEmployeeId)
      .maybeSingle();
    if (!data) return "invalid_manager";
  }

  return null;
}

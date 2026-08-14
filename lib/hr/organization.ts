import "server-only";

/**
 * HR-1 — Organization Foundation reads. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read side for the HR dashboard, the read-only organization tree and the
 * configuration workspace. All writes live in ./organization-actions.ts
 * (service-role, permission-gated, audited). Gates:
 *   dashboard/tree reads      hr:read
 *   configuration reads       hr:config:manage (granted to NOBODY until HRQ-D2)
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
export type HrPosition = Tbl["hr_position"]["Row"];
export type HrWorkLocation = Tbl["hr_work_location"]["Row"];
export type HrConfiguration = Tbl["hr_configuration"]["Row"];
export type HrImportBatch = Tbl["hr_import_batch"]["Row"];

// Pure tree helpers live in ./org-tree (no react/server coupling) so tests and
// client components can import them; re-exported here for server callers.
export {
  buildOrgTree,
  UNIT_KINDS,
  UNIT_KIND_LABEL_FR,
  type HrOrgUnit,
  type OrgTreeNode,
  type UnitKind,
} from "./org-tree";
import type { HrOrgUnit } from "./org-tree";

export const listOrgUnits = cache(async (tenantId: string): Promise<HrOrgUnit[]> => {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_org_unit")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[hr] org units read failed: ${error.message}`);
  return data ?? [];
});

export const listPositions = cache(async (tenantId: string): Promise<HrPosition[]> => {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_position")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("title", { ascending: true });
  if (error) throw new Error(`[hr] positions read failed: ${error.message}`);
  return data ?? [];
});

export const listWorkLocations = cache(async (tenantId: string): Promise<HrWorkLocation[]> => {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_work_location")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  if (error) throw new Error(`[hr] locations read failed: ${error.message}`);
  return data ?? [];
});

/** The tenant's configuration row, or null before first save (DRAFT-less). */
export const getHrConfiguration = cache(async (tenantId: string): Promise<HrConfiguration | null> => {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_configuration")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`[hr] configuration read failed: ${error.message}`);
  return data ?? null;
});

/** HR-B3 — validation errors for the listed batches, for the readable preview
 *  (« Ligne 17 — Poste « Comptble » introuvable »). */
export const listImportErrors = cache(async (tenantId: string, batchIds: string[]): Promise<
  { batch_id: string; row: number; message_fr: string }[]
> => {
  if (batchIds.length === 0) return [];
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_import_error")
    .select("batch_id, message_fr, staging_row:staging_row_id(source_row_number)")
    .eq("tenant_id", tenantId)
    .in("batch_id", batchIds)
    .limit(500)
    .returns<{ batch_id: string; message_fr: string; staging_row: { source_row_number: number } | null }[]>();
  if (error) throw new Error(`[hr] import errors read failed: ${error.message}`);
  return (data ?? [])
    .map((e) => ({
      batch_id: e.batch_id,
      row: e.staging_row?.source_row_number ?? 0,
      message_fr: e.message_fr,
    }))
    .sort((a, b) => a.row - b.row);
});

/** HR-B3 — the import report: which spreadsheet row became which employee. */
export const listImportOutcomes = cache(async (tenantId: string, batchIds: string[]): Promise<
  { batch_id: string; row: number; outcome: string | null; reason: string | null; employee_number: string | null; employee_name: string | null }[]
> => {
  if (batchIds.length === 0) return [];
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_import_staging_row")
    .select("batch_id, source_row_number, outcome, outcome_reason, employee:employee_id(employee_number, first_name, last_name)")
    .eq("tenant_id", tenantId)
    .in("batch_id", batchIds)
    .not("outcome", "is", null)
    .order("source_row_number")
    .limit(2000);
  if (error) throw new Error(`[hr] import outcomes read failed: ${error.message}`);
  // Embedded-relation selects are untyped for tables without Relationships;
  // the shape is asserted once here.
  const rows = (data ?? []) as unknown as {
    batch_id: string; source_row_number: number; outcome: string | null; outcome_reason: string | null;
    employee: { employee_number: string; first_name: string; last_name: string } | null;
  }[];
  return rows.map((r) => {
    const emp = r.employee;
    return {
      batch_id: r.batch_id,
      row: r.source_row_number,
      outcome: r.outcome ?? null,
      reason: r.outcome_reason ?? null,
      employee_number: emp?.employee_number ?? null,
      employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
    };
  });
});

export const listImportBatches = cache(async (tenantId: string): Promise<HrImportBatch[]> => {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("hr_import_batch")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[hr] import batches read failed: ${error.message}`);
  return data ?? [];
});

/** Dashboard counts — org structure + the live registry, one round each. */
export type HrDashboardCounts = {
  units: number;
  departments: number;
  positions: number;
  locations: number;
};

export const hrDashboardCounts = cache(async (tenantId: string): Promise<HrDashboardCounts> => {
  const supabase = getAdminSupabaseClient();
  const head = { count: "exact" as const, head: true };
  const [units, departments, positions, locations] = await Promise.all([
    supabase.from("hr_org_unit").select("id", head).eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("hr_org_unit").select("id", head).eq("tenant_id", tenantId).eq("is_active", true).eq("unit_kind", "DEPARTMENT"),
    supabase.from("hr_position").select("id", head).eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("hr_work_location").select("id", head).eq("tenant_id", tenantId).eq("is_active", true),
  ]);
  return {
    units: units.count ?? 0,
    departments: departments.count ?? 0,
    positions: positions.count ?? 0,
    locations: locations.count ?? 0,
  };
});

/** HR-2 — assignment history for one employee (open row first, then closed desc). */
export type EmployeeAssignmentRow = Tbl["employee_assignment"]["Row"];

export const listEmployeeAssignments = cache(
  async (tenantId: string, employeeId: string): Promise<EmployeeAssignmentRow[]> => {
    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("employee_assignment")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(`[hr] assignments read failed: ${error.message}`);
    const rows = data ?? [];
    return [...rows.filter((r) => r.effective_to === null), ...rows.filter((r) => r.effective_to !== null)];
  },
);

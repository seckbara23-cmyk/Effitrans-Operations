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

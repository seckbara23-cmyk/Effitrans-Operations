/**
 * Centre d'Opérations — workload readers (Phase 10.0B). SERVER-ONLY, read-only.
 * ---------------------------------------------------------------------------
 * NEW aggregations over EXISTING engine columns (phase-10.0a §13): open
 * process_step_execution rows grouped by `assigned_team_code` and by
 * `assigned_user_id`. No schema change, no mutation, no business rule — the
 * engine owns the assignments; this file only counts them.
 *
 * DEC-B30 (binding):
 *  - workload is operational COORDINATION data, never a performance score;
 *  - NAMED per-person rows require the platform's established supervision
 *    boundary — analytics:read (the management gate used by the control tower,
 *    Direction and /reports) — reused, NOT a new permission;
 *  - everyone else gets only the aggregated department/team rollups
 *    (rollupQueueDepths over getQueueCounts, composed in ./reader);
 *  - no HR data — display names come from app_user (the same account surface
 *    /users and the queue assignee filters already show).
 *
 * Flag discipline: this reads engine data, so it returns null when the tenant's
 * workspaces flag is off (same contract as getProcessTower) and degrades to
 * null when the engine tables are absent. Missing ≠ Negative.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { OPEN_STATES } from "@/lib/process/engine/types";
import { countByKey, toTeamWorkload, toUserWorkload } from "./compose";
import type { UserWorkloadEntry, WorkloadEntry } from "./types";

/** Bounded working set — same cap discipline as getQueueCounts. */
const OPEN_EXECUTION_CAP = 2000;

async function engineDark(tenantId: string): Promise<boolean> {
  if (!globalKillSwitch().workspaces) return true;
  const flags = await getTenantProcessFlags(tenantId);
  return !flags.enabled || !flags.workspaces;
}

/** Open engine work grouped by Transit team (AIBD / MARITIME). Null when dark / unauthorized. */
export async function getWorkloadByTeam(
  tenantId: string,
  permissions: string[],
): Promise<WorkloadEntry[] | null> {
  if (!hasPermission(permissions, "process:read")) return null;
  if (await engineDark(tenantId)) return null;

  const admin = getAdminSupabaseClient();
  const { data, error } = await scopedFrom(admin, "process_step_execution", tenantId)
    .select("assigned_team_code")
    .in("state", [...OPEN_STATES])
    .limit(OPEN_EXECUTION_CAP)
    .returns<{ assigned_team_code: string | null }[]>();
  if (error) return null; // 9.0B structures absent — degrade, never fabricate

  return toTeamWorkload(countByKey((data ?? []).map((r) => ({ key: r.assigned_team_code }))));
}

/**
 * Open engine work grouped by assignee, with display names (DEC-B30: supervision
 * boundary only). Null when dark or without analytics:read.
 */
export async function getWorkloadByUser(
  tenantId: string,
  permissions: string[],
): Promise<UserWorkloadEntry[] | null> {
  if (!hasPermission(permissions, "analytics:read")) return null; // DEC-B30 named-workload gate
  if (await engineDark(tenantId)) return null;

  const admin = getAdminSupabaseClient();
  const { data, error } = await scopedFrom(admin, "process_step_execution", tenantId)
    .select("assigned_user_id")
    .in("state", [...OPEN_STATES])
    .limit(OPEN_EXECUTION_CAP)
    .returns<{ assigned_user_id: string | null }[]>();
  if (error) return null;

  const counts = countByKey((data ?? []).map((r) => ({ key: r.assigned_user_id })));
  if (counts.size === 0) return [];

  // Batch display names — never render a UUID (same idiom as getFinanceState).
  const { data: users } = await admin
    .from("app_user")
    .select("id, name, email")
    .eq("tenant_id", tenantId)
    .in("id", [...counts.keys()])
    .returns<{ id: string; name: string | null; email: string }[]>();
  const names = new Map<string, string>();
  for (const u of users ?? []) names.set(u.id, u.name?.trim() || u.email);

  return toUserWorkload(counts, names);
}

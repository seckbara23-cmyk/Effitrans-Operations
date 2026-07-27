/**
 * Eligible assignees for a task (Phase WES-3A.1). SERVER-ONLY, READ-ONLY.
 * ---------------------------------------------------------------------------
 * The assignment UI must offer only people the PINNED policy actually permits.
 * Before this, the picker listed every staff member in the tenant and the
 * server had no eligibility check at all, so any name in the list "worked".
 *
 * This is a convenience list, never authorization: `assignTaskToUser`
 * re-resolves eligibility server-side on every call. If the two ever disagree,
 * the action wins and the UI is simply showing a stale option.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveSeatEligibility } from "./eligibility";
import { isEligibleForSeat } from "./seat";

export type EligibleAssignee = { id: string; label: string };

export type EligibilityListing = {
  assignees: EligibleAssignee[];
  /** False when the pinned policy could not be resolved — the UI must say so
   *  rather than presenting an empty list as "nobody is available". */
  resolved: boolean;
};

/**
 * Keyed by DOSSIER, not by task: every task on a dossier is governed by the
 * same pinned policy and the same current step, so one resolution serves the
 * whole panel instead of one per row.
 */
export async function listEligibleAssigneesForFile(
  fileId: string,
): Promise<EligibilityListing> {
  const user = await getCurrentUser();
  if (!user) return { assignees: [], resolved: false };

  const supabase = getAdminSupabaseClient();

  const { data: file } = await supabase
    .from("operational_file")
    .select("id")
    .eq("id", fileId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{ id: string }>();
  if (!file) return { assignees: [], resolved: false };

  return resolveFor(supabase, user.tenantId, fileId);
}

export async function listEligibleAssignees(taskId: string): Promise<EligibilityListing> {
  const user = await getCurrentUser();
  if (!user) return { assignees: [], resolved: false };

  const supabase = getAdminSupabaseClient();

  const { data: task } = await supabase
    .from("task")
    .select("id, file_id")
    .eq("id", taskId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle<{ id: string; file_id: string }>();
  if (!task) return { assignees: [], resolved: false };

  return resolveFor(supabase, user.tenantId, task.file_id);
}

async function resolveFor(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  tenantId: string,
  fileId: string,
): Promise<EligibilityListing> {
  const user = { tenantId };

  const { data: instance } = await supabase
    .from("process_instance")
    .select("id")
    .eq("file_id", fileId)
    .eq("tenant_id", user.tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  const { data: step } = instance
    ? await supabase
        .from("process_step_execution")
        .select("step_key")
        .eq("tenant_id", user.tenantId)
        .eq("process_instance_id", instance.id)
        .in("state", ["AVAILABLE", "ACTIVE", "PENDING"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle<{ step_key: string }>()
    : { data: null };

  const eligibility = await resolveSeatEligibility(
    { tenantId: user.tenantId, processInstanceId: instance?.id ?? null },
    step?.step_key ?? "",
    "assignee",
  );
  if (!eligibility.resolved) return { assignees: [], resolved: false };

  // ACTIVE members of this tenant holding an eligible role. Both filters
  // matter: the RPC refuses an inactive user, so offering one would produce a
  // failure the operator cannot explain.
  const { data: candidates } = await supabase
    .from("user_role")
    .select("user_id, role:role_id(code), user:user_id(id, name, email, status, tenant_id)")
    .eq("tenant_id", user.tenantId)
    .returns<
      {
        user_id: string;
        role: { code: string } | null;
        user: { id: string; name: string | null; email: string; status: string; tenant_id: string } | null;
      }[]
    >();

  const byUser = new Map<string, { label: string; roles: string[] }>();
  for (const row of candidates ?? []) {
    if (!row.user || row.user.status !== "active") continue;
    if (row.user.tenant_id !== user.tenantId) continue;
    const entry = byUser.get(row.user.id) ?? {
      label: row.user.name ?? row.user.email,
      roles: [],
    };
    if (row.role?.code) entry.roles.push(row.role.code);
    byUser.set(row.user.id, entry);
  }

  const assignees: EligibleAssignee[] = [];
  for (const [id, entry] of byUser) {
    if (isEligibleForSeat(eligibility, entry.roles)) assignees.push({ id, label: entry.label });
  }
  assignees.sort((a, b) => a.label.localeCompare(b.label, "fr"));

  return { assignees, resolved: true };
}

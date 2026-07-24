/**
 * Task reads (Phase 1.3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Uses the service-role admin client (privileged read, gated by assertPermission
 * + tenant scope) — like user-management listUsers — because tasks join to
 * operational_file (file_number) and app_user (assignee), which carry their own
 * RLS (file:read / self-only) that a user-context embed cannot satisfy. The task
 * RLS SELECT policy + grant remain as the defense-in-depth boundary (CI-tested).
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { resolveFileScope, type FileScope } from "@/lib/authz/visibility";
import type {
  Assignee,
  DashboardTasks,
  TaskDetail,
  TaskListItem,
  TaskPriority,
  TaskStatus,
} from "./types";

const SELECT =
  "id, file_id, title, status, priority, due_at, assigned_to, created_by, description, completed_at, file:file_id(file_number), assignee:assigned_to(email)";

type TaskRow = {
  id: string;
  file_id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  description: string | null;
  completed_at: string | null;
  file: { file_number: string } | null;
  assignee: { email: string | null } | null;
};

/**
 * Phase 1.7: a PostgREST `.or()` clause restricting tasks to those a non-all
 * user may read — assigned to them, created by them, or on a readable file.
 * null when the user has task:read:all (no restriction).
 */
function taskScopeOr(scope: FileScope, userId: string): string | null {
  if (scope.all) return null;
  const clauses = [`assigned_to.eq.${userId}`, `created_by.eq.${userId}`];
  if (scope.ids.length) clauses.push(`file_id.in.(${scope.ids.join(",")})`);
  return clauses.join(",");
}

function toListItem(r: TaskRow): TaskListItem {
  return {
    id: r.id,
    fileId: r.file_id,
    fileNumber: r.file?.file_number ?? null,
    title: r.title,
    status: r.status as TaskStatus,
    priority: r.priority as TaskPriority,
    dueAt: r.due_at,
    assignedToEmail: r.assignee?.email ?? null,
  };
}

export async function listTasks(opts?: {
  fileId?: string;
  status?: TaskStatus;
  mine?: boolean;
  overdue?: boolean;
}): Promise<TaskListItem[]> {
  const user = await assertPermission("task:read");
  const scope = await resolveFileScope(user.id, user.tenantId, "task:read:all");
  const supabase = getAdminSupabaseClient();

  let q = supabase.from("task").select(SELECT).eq("tenant_id", user.tenantId);
  const scopeOr = taskScopeOr(scope, user.id);
  if (scopeOr) q = q.or(scopeOr);
  if (opts?.fileId) q = q.eq("file_id", opts.fileId);
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.mine) q = q.eq("assigned_to", user.id);
  if (opts?.overdue) q = q.lt("due_at", new Date().toISOString()).not("status", "in", "(DONE,CANCELLED)");

  const { data, error } = await q
    .order("due_at", { ascending: true, nullsFirst: false })
    .returns<TaskRow[]>();
  if (error) throw new Error(`[tasks] list failed: ${error.message}`);
  return (data ?? []).map(toListItem);
}

export async function getTask(id: string): Promise<TaskDetail | null> {
  const user = await assertPermission("task:read");
  const scope = await resolveFileScope(user.id, user.tenantId, "task:read:all");
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("task")
    .select(SELECT)
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .limit(1)
    .returns<TaskRow[]>();
  if (error) throw new Error(`[tasks] read failed: ${error.message}`);
  const r = data?.[0];
  if (!r) return null;
  // Phase 1.7: mirror can_read_task for the admin-client single read.
  if (!scope.all) {
    const visible =
      r.assigned_to === user.id || r.created_by === user.id || scope.ids.includes(r.file_id);
    if (!visible) return null;
  }
  return {
    ...toListItem(r),
    description: r.description,
    assignedTo: r.assigned_to,
    completedAt: r.completed_at,
  };
}

/** Active users in the caller's tenant, for the assignee picker. Gated by task:update. */
export async function listAssignees(): Promise<Assignee[]> {
  const user = await assertPermission("task:update");
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("app_user")
    .select("id, name, email")
    .eq("tenant_id", user.tenantId)
    .eq("status", "active")
    .order("email");
  if (error) throw new Error(`[tasks] assignees failed: ${error.message}`);
  return (data ?? []).map((u) => ({ id: u.id, label: u.name || u.email }));
}

// Phase 10.0C — request-level cache(): the cockpit composition reads the task KPIs
// while the preserved dashboard section reads the full lists; both share ONE read.
export const getDashboardTasks = cache(async (): Promise<DashboardTasks> => {
  const user = await assertPermission("task:read");
  const scope = await resolveFileScope(user.id, user.tenantId, "task:read:all");
  const supabase = getAdminSupabaseClient();

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const scopeOr = taskScopeOr(scope, user.id);
  const base = () => {
    let q = supabase.from("task").select(SELECT).eq("tenant_id", user.tenantId);
    if (scopeOr) q = q.or(scopeOr);
    return q;
  };

  const [today, overdue, mine] = await Promise.all([
    base()
      .gte("due_at", startOfDay.toISOString())
      .lte("due_at", endOfDay.toISOString())
      .not("status", "in", "(DONE,CANCELLED)")
      .order("due_at", { ascending: true })
      .returns<TaskRow[]>(),
    base()
      .lt("due_at", startOfDay.toISOString())
      .not("status", "in", "(DONE,CANCELLED)")
      .order("due_at", { ascending: true })
      .returns<TaskRow[]>(),
    base()
      .eq("assigned_to", user.id)
      .not("status", "in", "(DONE,CANCELLED)")
      .order("due_at", { ascending: true, nullsFirst: false })
      .returns<TaskRow[]>(),
  ]);

  return {
    today: (today.data ?? []).map(toListItem),
    overdue: (overdue.data ?? []).map(toListItem),
    mine: (mine.data ?? []).map(toListItem),
  };
});

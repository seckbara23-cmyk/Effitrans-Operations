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
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import type {
  Assignee,
  DashboardTasks,
  TaskDetail,
  TaskListItem,
  TaskPriority,
  TaskStatus,
} from "./types";

const SELECT =
  "id, file_id, title, status, priority, due_at, assigned_to, description, completed_at, file:file_id(file_number), assignee:assigned_to(email)";

type TaskRow = {
  id: string;
  file_id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  assigned_to: string | null;
  description: string | null;
  completed_at: string | null;
  file: { file_number: string } | null;
  assignee: { email: string | null } | null;
};

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
  const supabase = getAdminSupabaseClient();

  let q = supabase.from("task").select(SELECT).eq("tenant_id", user.tenantId);
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

export async function getDashboardTasks(): Promise<DashboardTasks> {
  const user = await assertPermission("task:read");
  const supabase = getAdminSupabaseClient();

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const base = () => supabase.from("task").select(SELECT).eq("tenant_id", user.tenantId);

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
}

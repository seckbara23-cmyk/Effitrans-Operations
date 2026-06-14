import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listTasks, listAssignees } from "@/lib/tasks/service";
import { TasksTable } from "@/components/tasks/tasks-table";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.tasks.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: { filter?: string };
}) {
  const header = <PageHeader meta="Opérations" title={t.tasks.title} subtitle={t.tasks.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.tasks.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "task:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.tasks.forbidden}</Notice></div>;
  }

  const filter = searchParams?.filter === "mine" ? "mine" : searchParams?.filter === "overdue" ? "overdue" : "all";
  const tasks = await listTasks(
    filter === "mine" ? { mine: true } : filter === "overdue" ? { overdue: true } : {},
  );
  const canUpdate = hasPermission(permissions, "task:update");
  const assignees = canUpdate ? await listAssignees() : [];

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <TasksTable
        tasks={tasks}
        assignees={assignees}
        canUpdate={canUpdate}
        canDelete={hasPermission(permissions, "task:delete")}
        filter={filter}
      />
    </div>
  );
}

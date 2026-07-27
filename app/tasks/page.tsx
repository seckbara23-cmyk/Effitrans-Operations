import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listTasks } from "@/lib/tasks/service";
import { listEligibleAssigneesForFile } from "@/lib/workflow/access/assignees";
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
  // The global list spans dossiers, each with its own pinned policy, so a
  // single eligible set cannot be correct here. Resolve per DISTINCT dossier
  // (bounded by the page) and let each row carry its own options.
  const fileIds = Array.from(new Set(tasks.map((t) => t.fileId)));
  const byFile = new Map<string, { assignees: { id: string; label: string }[]; resolved: boolean }>();
  if (canUpdate) {
    const listings = await Promise.all(fileIds.map((id) => listEligibleAssigneesForFile(id)));
    fileIds.forEach((id, i) => byFile.set(id, listings[i]));
  }

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <TasksTable
        tasks={tasks}
        eligibilityByFile={byFile}
        canUpdate={canUpdate}
        canDelete={hasPermission(permissions, "task:delete")}
        filter={filter}
      />
    </div>
  );
}

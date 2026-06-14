import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getFile } from "@/lib/files/service";
import { listClients } from "@/lib/clients/service";
import { FileForm } from "@/components/files/file-form";
import { FileWorkflow } from "@/components/files/file-workflow";
import { TaskPanel } from "@/components/tasks/task-panel";
import { listTasks, listAssignees } from "@/lib/tasks/service";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.files.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function FileDetailPage({ params }: { params: { id: string } }) {
  const header = (title: string) => (
    <PageHeader meta="Opérations" title={title} subtitle={t.files.subtitle} />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header(t.files.title)}<Notice>{t.files.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "file:read")) {
    return <div className="animate-fade-in space-y-6">{header(t.files.title)}<Notice>{t.files.forbidden}</Notice></div>;
  }

  const file = await getFile(params.id);
  if (!file) {
    return <div className="animate-fade-in space-y-6">{header(t.files.title)}<Notice>{t.files.errors.not_found}</Notice></div>;
  }

  const canUpdate = hasPermission(permissions, "file:update");
  const clients = hasPermission(permissions, "client:read")
    ? (await listClients()).map((c) => ({ id: c.id, name: c.name }))
    : file.clientId
      ? [{ id: file.clientId, name: file.clientName ?? file.clientId }]
      : [];

  // Embedded tasks (only if the user can read tasks).
  const canReadTasks = hasPermission(permissions, "task:read");
  const canUpdateTasks = hasPermission(permissions, "task:update");
  const tasks = canReadTasks ? await listTasks({ fileId: file.id }) : [];
  const taskAssignees = canUpdateTasks ? await listAssignees() : [];

  return (
    <div className="animate-fade-in space-y-6">
      {header(`${file.fileNumber}`)}
      <Link href="/files" className="text-sm text-teal-700 hover:underline">
        ← {t.files.backToList}
      </Link>
      <FileWorkflow file={file} canUpdate={canUpdate} />
      <FileForm mode="edit" fileId={file.id} initial={file} clients={clients} canUpdate={canUpdate} />
      {canReadTasks && (
        <TaskPanel
          fileId={file.id}
          tasks={tasks}
          assignees={taskAssignees}
          canCreate={hasPermission(permissions, "task:create")}
          canUpdate={canUpdateTasks}
          canDelete={hasPermission(permissions, "task:delete")}
        />
      )}
    </div>
  );
}

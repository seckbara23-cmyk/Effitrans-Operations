import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listFiles } from "@/lib/files/service";
import { FilesTable } from "@/components/files/files-table";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.files.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function FilesPage() {
  const header = <PageHeader meta="Opérations" title={t.files.title} subtitle={t.files.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.files.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "file:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.files.forbidden}</Notice></div>;
  }

  const files = await listFiles();

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <FilesTable files={files} canCreate={hasPermission(permissions, "file:create")} />
    </div>
  );
}

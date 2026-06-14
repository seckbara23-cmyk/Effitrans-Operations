import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listClients } from "@/lib/clients/service";
import { FileForm } from "@/components/files/file-form";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.files.new };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function NewFilePage() {
  const header = <PageHeader meta="Opérations" title={t.files.new} subtitle={t.files.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.files.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "file:create")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.files.forbidden}</Notice></div>;
  }

  // Client picker — only fetched if the user can read clients.
  const clients = hasPermission(permissions, "client:read")
    ? (await listClients()).map((c) => ({ id: c.id, name: c.name }))
    : [];

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <Link href="/files" className="text-sm text-teal-700 hover:underline">
        ← {t.files.backToList}
      </Link>
      <FileForm mode="create" clients={clients} />
    </div>
  );
}

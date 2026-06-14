import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listClients } from "@/lib/clients/service";
import { ClientsTable } from "@/components/clients/clients-table";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.clients.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams?: { archived?: string };
}) {
  const header = <PageHeader meta="Opérations" title={t.clients.title} subtitle={t.clients.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.clients.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "client:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.clients.forbidden}</Notice></div>;
  }

  const includeArchived = searchParams?.archived === "1";
  const clients = await listClients({ includeArchived });

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <ClientsTable
        clients={clients}
        canCreate={hasPermission(permissions, "client:create")}
        canDelete={hasPermission(permissions, "client:delete")}
        includeArchived={includeArchived}
      />
    </div>
  );
}

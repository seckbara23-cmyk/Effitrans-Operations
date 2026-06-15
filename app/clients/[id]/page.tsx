import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getClient } from "@/lib/clients/service";
import { ClientForm } from "@/components/clients/client-form";
import { PortalUsersPanel } from "@/components/portal/portal-users-panel";
import { listClientPortalUsers } from "@/lib/portal/admin";
import { CommunicationsTimeline } from "@/components/communications/communications-timeline";
import { listCommunicationsForClient } from "@/lib/comms/service";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.clients.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const header = (title: string) => (
    <PageHeader meta="Opérations" title={title} subtitle={t.clients.subtitle} />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header(t.clients.title)}<Notice>{t.clients.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "client:read")) {
    return <div className="animate-fade-in space-y-6">{header(t.clients.title)}<Notice>{t.clients.forbidden}</Notice></div>;
  }

  const client = await getClient(params.id);
  if (!client) {
    return (
      <div className="animate-fade-in space-y-6">
        {header(t.clients.title)}
        <Notice>{t.clients.errors.not_found}</Notice>
      </div>
    );
  }

  const canManagePortal = hasPermission(permissions, "portal:manage");
  const portalUsers = canManagePortal ? await listClientPortalUsers(client.id) : [];
  const canEmail = hasPermission(permissions, "communication:send");
  const canReadComms = hasPermission(permissions, "communication:read");
  const communications = canReadComms ? await listCommunicationsForClient(client.id) : [];

  return (
    <div className="animate-fade-in space-y-6">
      {header(client.name)}
      <Link href="/clients" className="text-sm text-teal-700 hover:underline">
        ← {t.clients.backToList}
      </Link>
      <ClientForm
        mode="edit"
        clientId={client.id}
        initial={client}
        canUpdate={hasPermission(permissions, "client:update")}
        canDelete={hasPermission(permissions, "client:delete")}
      />
      {canManagePortal && <PortalUsersPanel clientId={client.id} users={portalUsers} canEmail={canEmail} />}
      {canReadComms && <CommunicationsTimeline messages={communications} />}
    </div>
  );
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listStaffConversations, getStaffConversationDetail } from "@/lib/messaging/service";
import { MessagingCenter } from "@/components/messaging/messaging-center";

export const metadata: Metadata = { title: "Messagerie" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

// Not rollout-gated — see app/messages/page.tsx's header comment: a direct link to
// an existing conversation (e.g. from a "Contacter Effitrans" reply) must always work.
export default async function MessageThreadPage({ params }: { params: { id: string } }) {
  const header = (
    <PageHeader meta="Opérations" title="Messagerie" subtitle="Conversations internes et demandes clients" />
  );

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "messaging:read")) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <Notice>Vous n&apos;avez pas accès à la messagerie.</Notice>
      </div>
    );
  }

  const [conversations, detail] = await Promise.all([
    listStaffConversations(),
    getStaffConversationDetail(params.id),
  ]);
  const canManage = hasPermission(permissions, "messaging:manage");

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <MessagingCenter
        initialConversations={conversations}
        canManage={canManage}
        initialSelectedId={params.id}
        initialDetail={detail}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listStaffConversations } from "@/lib/messaging/service";
import { MessagingCenter } from "@/components/messaging/messaging-center";

export const metadata: Metadata = { title: "Messagerie" };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

/**
 * NOT gated by the tenant messaging rollout flag (lib/messaging/rollout.ts) — that
 * flag only controls the NAV LINK's visibility (discoverability), so a tenant that
 * hasn't opted in sees no dangling entry point. It must not also block this page,
 * because "Contacter Effitrans" (lib/portal/self-service-actions.ts's
 * contactEffitrans) is an ALWAYS-ON existing customer feature that now creates a
 * real conversation — staff must always be able to open and answer it here, on a
 * direct link, even for a tenant that has not turned on the broader feature.
 * Authorization is the messaging:read PERMISSION, exactly like every other page.
 */
export default async function MessagesPage() {
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

  // Best-effort: the migration that creates conversation/message may not be applied
  // to every environment the instant this code deploys (this repo's migrations are
  // operator-applied, not auto-run — see docs/messaging/acceptance.md). Degrade to a
  // friendly notice instead of a hard 500 if the tables aren't there yet.
  let conversations: Awaited<ReturnType<typeof listStaffConversations>>;
  try {
    conversations = await listStaffConversations();
  } catch {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <Notice>La messagerie est temporairement indisponible. Réessayez dans un instant.</Notice>
      </div>
    );
  }
  const canManage = hasPermission(permissions, "messaging:manage");

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <MessagingCenter initialConversations={conversations} canManage={canManage} />
    </div>
  );
}

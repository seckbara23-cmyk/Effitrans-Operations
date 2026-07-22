import type { Metadata } from "next";
import { requirePortalUser } from "@/lib/portal/auth";
import { listPortalConversations } from "@/lib/messaging/service";
import { PortalMessaging } from "@/components/portal/messaging/portal-messaging";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: `${t.portal.nav.messages} · ${t.portal.brand}` };
export const dynamic = "force-dynamic";

// Not rollout-gated at the page level — see app/messages/page.tsx's header comment
// for why (an always-on "Contacter Effitrans" reply must always be reachable).
export default async function PortalMessagesPage() {
  await requirePortalUser();
  const conversations = await listPortalConversations();
  return (
    <div className="animate-fade-in space-y-4">
      <div>
        <h1 className="text-lg font-bold text-navy-900">Support Effitrans</h1>
        <p className="text-sm text-slate-500">Vos demandes et échanges avec l&apos;équipe Effitrans.</p>
      </div>
      <PortalMessaging initialConversations={conversations} />
    </div>
  );
}

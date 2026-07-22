import type { Metadata } from "next";
import { requirePortalUser } from "@/lib/portal/auth";
import { listPortalConversations, getPortalConversationDetail } from "@/lib/messaging/service";
import { PortalMessaging } from "@/components/portal/messaging/portal-messaging";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: `${t.portal.nav.messages} · ${t.portal.brand}` };
export const dynamic = "force-dynamic";

export default async function PortalMessageThreadPage({ params }: { params: { id: string } }) {
  await requirePortalUser();
  // Best-effort — see app/messages/page.tsx's comment on operator-applied migrations.
  let conversations: Awaited<ReturnType<typeof listPortalConversations>>;
  let detail: Awaited<ReturnType<typeof getPortalConversationDetail>>;
  try {
    [conversations, detail] = await Promise.all([
      listPortalConversations(),
      getPortalConversationDetail(params.id),
    ]);
  } catch {
    return (
      <div className="animate-fade-in space-y-4">
        <div>
          <h1 className="text-lg font-bold text-navy-900">Support Effitrans</h1>
        </div>
        <div className="surface p-6 text-sm text-slate-600">Le support est temporairement indisponible. Réessayez dans un instant.</div>
      </div>
    );
  }
  return (
    <div className="animate-fade-in space-y-4">
      <div>
        <h1 className="text-lg font-bold text-navy-900">Support Effitrans</h1>
        <p className="text-sm text-slate-500">Vos demandes et échanges avec l&apos;équipe Effitrans.</p>
      </div>
      <PortalMessaging initialConversations={conversations} initialSelectedId={params.id} initialDetail={detail} />
    </div>
  );
}

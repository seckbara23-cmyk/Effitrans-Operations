import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listCommunications } from "@/lib/comms/service";
import { MailList } from "@/components/ec/mail-list";

export const metadata: Metadata = { title: "Envoyés" };
export const dynamic = "force-dynamic";

/**
 * Enterprise Mail — Sent.
 *
 * A filtered view over the ONE outbound queue, not a second store: the same
 * `communication_message` rows the journal shows, narrowed to those a real
 * provider accepted.
 *
 * "Sent" here means exactly what EMP-3 made it mean — the provider accepted the
 * message. It is not delivery: this platform has no bounce webhook, so
 * `DELIVERED` and `READ` do not exist and are never implied.
 */
export default async function SentPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:read")) notFound();

  const messages = await listCommunications({ status: "SENT" });

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Enterprise Mail"
        title="Envoyés"
        subtitle="Messages acceptés par le fournisseur d'envoi."
      />
      <MailList
        messages={messages}
        emptyLabel="Aucun message envoyé."
        note="« Envoyé » signifie que le fournisseur a accepté le message. La remise n'est pas prouvable : aucun état « remis » ou « lu » n'existe."
      />
    </div>
  );
}

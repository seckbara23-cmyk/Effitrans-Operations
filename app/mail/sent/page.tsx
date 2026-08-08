import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listOutboundCommunications } from "@/lib/comms/service";
import { MailList } from "@/components/ec/mail-list";

export const metadata: Metadata = { title: "Envoyés" };
export const dynamic = "force-dynamic";

/**
 * Enterprise Mail — Envoyés (EMPLOYEE).
 *
 * A filtered view over the ONE outbound queue, not a second store: the same
 * `communication_message` rows the technical journal shows, framed for the
 * person who wrote the message rather than the person operating the system.
 *
 * EMP-IA-1 widened it from `status = SENT` to every non-draft message. It
 * previously hid anything queued, failed or cancelled, which meant a failed
 * send was visible only in the outbound journal — and that journal is now
 * administrative. A Sent folder that silently drops your failed messages is
 * worse than one that shows them with their state, so each row carries its own.
 *
 * "Sent" still means exactly what EMP-3 made it mean — the provider accepted
 * the message. It is not delivery: this platform has no bounce webhook, so
 * `DELIVERED` and `READ` do not exist and are never implied.
 */
export default async function SentPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:read")) notFound();

  const messages = await listOutboundCommunications();

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Enterprise Mail"
        title="Envoyés"
        subtitle="Vos messages sortants et leur état."
      />
      <MailList
        messages={messages}
        emptyLabel="Aucun message envoyé."
        note="« Envoyé » signifie que le fournisseur a accepté le message. La remise n'est pas prouvable : aucun état « remis » ou « lu » n'existe. Les diagnostics techniques (relances, erreurs du fournisseur) relèvent de l'administration."
      />
    </div>
  );
}

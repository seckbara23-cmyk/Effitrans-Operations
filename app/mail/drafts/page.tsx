import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listCommunications } from "@/lib/comms/service";
import { MailList } from "@/components/ec/mail-list";

export const metadata: Metadata = { title: "Brouillons" };
export const dynamic = "force-dynamic";

/**
 * Enterprise Mail — Drafts.
 *
 * The same outbound queue, narrowed to `DRAFT`. Reading drafts needs only
 * `communication:read`, because a draft is not a communication: EMP-3 made
 * drafting and sending separate acts with separate authorities, and nothing
 * here can dispatch.
 */
export default async function DraftsPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:read")) notFound();

  const messages = await listCommunications({ status: "DRAFT" });

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Enterprise Mail"
        title="Brouillons"
        subtitle="Messages préparés, non transmis."
      />
      <MailList
        messages={messages}
        emptyLabel="Aucun brouillon."
        note="Un brouillon n'est pas une correspondance : il n'apparaît dans aucun journal opérationnel et n'a été transmis à aucun fournisseur."
      />
    </div>
  );
}

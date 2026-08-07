import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { isProviderConfigured } from "@/lib/comms/provider";
import { outboundEnabled } from "@/lib/comms/dispatch";
import { Composer, type MailboxOption } from "@/components/ec/composer";

export const metadata: Metadata = { title: "Nouveau message" };
export const dynamic = "force-dynamic";

/**
 * EMP-3 — compose and reply.
 *
 * Reading this page needs `communication:read` (drafting authority); the Send
 * button additionally needs `communication:send`. Both are re-checked in the
 * server actions, so what is rendered here is a convenience and never the
 * control.
 *
 * Only ACTIVE mailboxes are offered, because an inactive one cannot send and
 * offering it would be an invitation to a refusal.
 */
export default async function ComposePage({
  searchParams,
}: {
  searchParams?: { reply?: string; all?: string; subject?: string; to?: string };
}) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:read")) notFound();

  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("ec_mailbox")
    .select("id, address, label_fr")
    .eq("tenant_id", user.tenantId)
    .eq("is_active", true)
    .order("address");

  const mailboxes: MailboxOption[] = ((data ?? []) as unknown as Record<string, string>[]).map((m) => ({
    id: m.id, address: m.address, label: m.label_fr,
  }));

  const ready = outboundEnabled() && isProviderConfigured();

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Communications"
        title={searchParams?.reply ? "Répondre" : "Nouveau message"}
        subtitle="La rédaction et l'envoi sont deux actes distincts."
      />

      {/* Both halves of the rollout, stated separately: an operator needs to
          know WHICH one is holding mail back. */}
      {!ready ? (
        <p className="surface p-4 text-sm text-amber-800" role="status">
          L&apos;envoi est indisponible :{" "}
          {!outboundEnabled() ? "le module sortant est désactivé pour ce tenant" : null}
          {!outboundEnabled() && !isProviderConfigured() ? " et " : null}
          {!isProviderConfigured() ? "aucun fournisseur d'envoi n'est configuré" : null}. Les
          brouillons restent enregistrables ; rien ne sera transmis ni marqué comme envoyé.
        </p>
      ) : null}

      <Composer
        mailboxes={mailboxes}
        canSend={hasPermission(permissions, "communication:send") && ready}
        replyToMessageId={searchParams?.reply ?? null}
        replyAll={searchParams?.all === "1"}
        defaultSubject={searchParams?.subject}
        defaultTo={searchParams?.to}
      />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listMailboxSummaries, listMailboxMembers } from "@/lib/ec/mailboxes/membership";
import { MailboxAdminPanel } from "@/components/ec/mailbox-admin-panel";

export const metadata: Metadata = { title: "Enterprise Mail — administration" };
export const dynamic = "force-dynamic";

/**
 * Administration → Users → Enterprise Mail.
 *
 * The single operational centre for mailbox identity and access. Deliberately
 * NOT in the /mail workspace: using a mailbox and deciding who may use it are
 * different jobs held by different people, and putting the second inside the
 * first would make the mail workspace the place where access is granted.
 *
 * Two authorities, checked separately so the page can show exactly what this
 * administrator may do:
 *   `communication:mailbox:provision`  — mailbox identities and lifecycle
 *   `communication:membership:manage`  — who belongs to them
 *
 * Neither is held by SYSTEM_ADMIN, and MAIL_ADMIN — which holds both — cannot
 * read correspondence: administering access is not the same as having it.
 */
export default async function EnterpriseMailAdminPage({
  searchParams,
}: {
  searchParams?: { mailbox?: string };
}) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);

  const canProvision = hasPermission(permissions, "communication:mailbox:provision");
  const canManageMembers = hasPermission(permissions, "communication:membership:manage");
  if (!canProvision && !canManageMembers) notFound();

  const mailboxes = await listMailboxSummaries(user.tenantId);
  const selected = searchParams?.mailbox
    ? mailboxes.find((m) => m.id === searchParams.mailbox)
    : mailboxes[0];
  const members = selected && canManageMembers
    ? await listMailboxMembers(user.tenantId, selected.id)
    : [];

  const pending = mailboxes.filter((m) => m.provisioningStatus === "PENDING_EXTERNAL_SETUP").length;
  const failed = mailboxes.filter((m) => m.provisioningStatus === "SETUP_FAILED").length;
  const active = mailboxes.filter((m) => m.provisioningStatus === "ACTIVE").length;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap gap-4">
        <Link href="/users" className="text-sm text-teal-700 hover:underline">
          ← Utilisateurs
        </Link>
        {canManageMembers ? (
          <Link href="/users/enterprise-mail/bulk" className="text-sm text-teal-700 hover:underline">
            Attribution en masse →
          </Link>
        ) : null}
      </div>

      <PageHeader
        meta="Administration · Utilisateurs"
        title="Enterprise Mail"
        subtitle="Identités de boîtes, cycle de vie et appartenances."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Boîtes actives" value={String(active)} />
        <StatCard label="En attente de configuration" value={String(pending)} tone={pending > 0 ? "amber" : "slate"} />
        <StatCard label="Configuration échouée" value={String(failed)} tone={failed > 0 ? "red" : "slate"} />
        <StatCard label="Boîtes au total" value={String(mailboxes.length)} />
      </div>

      {/* The honesty line. Everything on this page reserves an identity and
          records what a person did outside the platform; nothing here creates a
          mailbox at a provider, because no such integration exists. */}
      <p className="surface p-4 text-[11px] text-slate-600">
        La création de la boîte chez le fournisseur reste une opération manuelle : cette
        plateforme n&apos;intègre aucun fournisseur de messagerie. « Provisionner » réserve
        l&apos;identité interne et l&apos;adresse ; un opérateur crée la boîte puis enregistre ici
        le résultat. Un nouvel essai relance la demande à l&apos;opérateur — il n&apos;appelle
        aucun service externe.
      </p>

      <MailboxAdminPanel
        mailboxes={mailboxes}
        selectedId={selected?.id ?? null}
        members={members}
        canProvision={canProvision}
        canManageMembers={canManageMembers}
      />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  listMailboxSummaries, listMailboxMembers, lifecycleFacts,
  countProvisioningAdministrators, latestLegacyDecisions,
} from "@/lib/ec/mailboxes/membership";
import { buildLifecycleView, type MailboxLifecycleView } from "@/lib/ec/mailboxes/lifecycle";
import { MailboxAdminPanel } from "@/components/ec/mailbox-admin-panel";
import { MailboxReadinessTable } from "@/components/ec/mailbox-readiness-table";

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

  // EMP-5F — every lifecycle judgement is made HERE, on the server, with one
  // `now`. The panel renders the answer; it evaluates no rule of its own, so
  // there is no second copy of the activation rules to drift.
  const now = new Date().toISOString();
  const actor = { id: user.id, tenantId: user.tenantId, canProvision };
  // EMP-5H — maker-checker needs two DISTINCT holders of the provisioning
  // permission. Counting them here lets the surface answer "is there anybody
  // else who could activate this?" instead of leaving it to be discovered when
  // activation refuses.
  const eligibleAdministrators = await countProvisioningAdministrators(user.tenantId);
  const views: Record<string, MailboxLifecycleView> = {};
  for (const m of mailboxes) {
    views[m.id] = buildLifecycleView({
      actor, mailbox: lifecycleFacts(m, user.tenantId), now, eligibleAdministrators,
    });
  }

  // EMP-5H.1 — the latest recorded governance decision for each legacy-active
  // mailbox, read from the audit trail so a recorded act is visible where it
  // was taken. Display-only: it feeds no view and changes no state.
  const legacyIds = mailboxes.filter((m) => views[m.id].legacyActive).map((m) => m.id);
  const legacyDecisions = await latestLegacyDecisions(user.tenantId, legacyIds);

  const pending = mailboxes.filter((m) => views[m.id].state === "CONFIGURATION_REQUIRED").length;
  const failed = mailboxes.filter((m) => views[m.id].state === "FAILED").length;
  const active = mailboxes.filter((m) => views[m.id].state === "ACTIVE").length;
  const legacy = mailboxes.filter((m) => views[m.id].legacyActive).length;

  return (
    <div className="animate-fade-in space-y-6">
      {/* EMP-IA-1 — bulk assignment is now the « Utilisateurs et accès » tab in
          this workspace's own nav, so the inline link that used to live here
          would be a second route to the same page one line above it. */}
      <Link href="/users" className="text-sm text-teal-700 hover:underline">
        ← Utilisateurs
      </Link>

      <PageHeader
        meta="Administration · Enterprise Mail"
        title="Enterprise Mail"
        subtitle="Identités de boîtes, cycle de vie et appartenances."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Boîtes actives" value={String(active)} />
        <StatCard label="En attente de configuration" value={String(pending)} tone={pending > 0 ? "amber" : "slate"} />
        <StatCard label="Échec" value={String(failed)} tone={failed > 0 ? "red" : "slate"} />
        <StatCard
          label="Actives sans vérification"
          value={String(legacy)}
          tone={legacy > 0 ? "amber" : "slate"}
        />
      </div>

      {/* The honesty line. Everything on this page reserves an identity and
          records what a person did outside the platform; nothing here creates a
          mailbox at a provider, because no such integration exists. */}
      <p className="surface p-4 text-[11px] text-slate-600">
        La création de la boîte chez le fournisseur reste une opération manuelle : cette
        plateforme n&apos;intègre aucun fournisseur de messagerie. Le cycle de vie —{" "}
        <strong>Réserver → Configurer → Vérifier → Activer</strong> — enregistre ce que des
        personnes identifiées ont fait et constaté. « Active » signifie <em>vérifiée puis mise
        en service</em>, jamais « un opérateur a cliqué sur succès » : la personne qui
        enregistre la vérification ne peut pas être celle qui active.
      </p>

      <MailboxReadinessTable
        mailboxes={mailboxes}
        views={views}
        eligibleAdministrators={eligibleAdministrators}
      />

      <MailboxAdminPanel
        mailboxes={mailboxes}
        views={views}
        selectedId={selected?.id ?? null}
        members={members}
        canProvision={canProvision}
        canManageMembers={canManageMembers}
        legacyDecisions={legacyDecisions}
      />
    </div>
  );
}

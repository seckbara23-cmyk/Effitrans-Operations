import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { MailNav, type MailTab } from "@/components/ec/mail-nav";

/**
 * Enterprise Mail — the workspace shell.
 *
 * Before this phase, `/mail` (the outbound log) and
 * `/mail/inbox` (the inbound queue) were two unlinked pages that
 * happened to share a URL prefix. This layout makes them one workspace and adds
 * mailbox administration beside them.
 *
 * It adds composition only: every page still gates itself. The tabs are built
 * from permissions purely so that a user is not offered a route that would
 * 404 on arrival — the permission check that matters is the one on the page.
 */
export default async function CommunicationsLayout({ children }: { children: React.ReactNode }) {
  const tabs: MailTab[] = [];

  // Without Supabase configured there is no session to resolve; render the
  // children bare and let each page show its own "not configured" notice.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const user = await requireUser();
    const permissions = await getEffectivePermissions(user.id);

    // Ordered as the workspace reads: what arrived, what we wrote, where it
    // comes from. Archive and Attachments are named in the target IA but have
    // no surface yet — an empty tab promising a page that does not exist is
    // worse than its absence, so they are added when they are built.
    if (hasPermission(permissions, "communication:inbound:read")) {
      tabs.push({ href: "/mail/inbox", label: "Boîte de réception" });
    }
    if (hasPermission(permissions, "communication:read")) {
      // EMP-3 — drafting authority, not sending: a user who may compose but
      // not send still needs the surface, and Send is gated separately.
      tabs.push({ href: "/mail/compose", label: "Nouveau message" });
      tabs.push({ href: "/mail/drafts", label: "Brouillons" });
      tabs.push({ href: "/mail/sent", label: "Envoyés" });
      tabs.push({ href: "/mail", label: "Journal des envois" });
    }
    if (hasPermission(permissions, "communication:manage")) {
      tabs.push({ href: "/mail/mailboxes", label: "Boîtes aux lettres" });
    }
  }

  return (
    <div className="animate-fade-in">
      <MailNav tabs={tabs} />
      {children}
    </div>
  );
}

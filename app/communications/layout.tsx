import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { MailNav, type MailTab } from "@/components/ec/mail-nav";

/**
 * EMP-1 — the mail workspace shell.
 *
 * Before this phase, `/communications` (the outbound log) and
 * `/communications/triage` (the inbound queue) were two unlinked pages that
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

    if (hasPermission(permissions, "communication:read")) {
      tabs.push({ href: "/communications", label: "Envois" });
    }
    if (hasPermission(permissions, "communication:inbound:read")) {
      tabs.push({ href: "/communications/triage", label: "Courrier entrant" });
    }
    if (hasPermission(permissions, "communication:manage")) {
      tabs.push({ href: "/communications/mailboxes", label: "Boîtes aux lettres" });
    }
  }

  return (
    <div className="animate-fade-in">
      <MailNav tabs={tabs} />
      {children}
    </div>
  );
}

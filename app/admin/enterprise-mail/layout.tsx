import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { MailNav, type MailTab } from "@/components/ec/mail-nav";

/**
 * Administration → Administration Mail — the GOVERNANCE workspace shell.
 *
 * EMP-IA-1. The counterpart to /mail: employees use Enterprise Mail to do
 * email; administrators come here to operate and govern the mail system.
 *
 *   Utilisateurs et accès | Boîtes aux lettres | État de la capture | Journal technique des envois
 *
 * The main sidebar is frozen, so a workspace made of several routes needs its
 * own nested layout or its surfaces become unreachable — the Phase 7.2C lesson,
 * which is exactly how the triage queue once ended up with nothing linking to
 * it. This layout is that link.
 *
 * Tabs follow authority, not appearance. Each is shown only to a holder of the
 * permission its page enforces, so nothing is offered that would 404 on
 * arrival — and no tab makes a route reachable that was not already.
 */
export default async function AdministrationMailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tabs: MailTab[] = [];

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const user = await requireUser();
    const permissions = await getEffectivePermissions(user.id);

    // Who may use which mailbox. EMP-4A's authority, unchanged.
    if (hasPermission(permissions, "communication:membership:manage")) {
      tabs.push({ href: "/admin/enterprise-mail/access", label: "Utilisateurs et accès" });
    }
    // Mailbox identities and lifecycle. Either administrative authority opens it,
    // matching the page's own gate.
    if (hasPermission(permissions, "communication:mailbox:provision")
        || hasPermission(permissions, "communication:membership:manage")) {
      tabs.push({ href: "/admin/enterprise-mail/mailboxes", label: "Boîtes aux lettres" });
    }
    // Operational state of inbound capture, and the outbound dispatch journal.
    if (hasPermission(permissions, "communication:manage")) {
      tabs.push({ href: "/admin/enterprise-mail/capture", label: "État de la capture" });
      tabs.push({ href: "/admin/enterprise-mail/journal", label: "Journal technique des envois" });
    }
  }

  return (
    <div className="animate-fade-in">
      <MailNav tabs={tabs} />
      {children}
    </div>
  );
}

import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { MailNav, type MailTab } from "@/components/ec/mail-nav";

/**
 * Enterprise Mail — the EMPLOYEE workspace shell.
 *
 * EMP-IA-1 froze this workspace to five items, in this order:
 *
 *   Boîte de réception | Nouveau message | Brouillons | Envoyés | Boîtes aux lettres
 *
 * The rule the order encodes: employees use Enterprise Mail to DO email.
 * Operating and governing the mail system is a different job and lives in
 * Administration → Enterprise Mail.
 *
 * « Journal des envois » was removed from this bar. It is not a Sent folder —
 * it is queue state, provider acceptance, failures, retries and cancellations,
 * which is operational diagnostics rather than "mail I sent". It still exists,
 * as « Journal technique des envois » under Administration. « Envoyés » is the
 * employee-facing answer to the same question, and the two are deliberately
 * not merged.
 *
 * Tabs are still built from permissions purely so nobody is offered a route
 * that would 404 on arrival. The check that matters is the one on each page.
 */
export default async function EnterpriseMailLayout({ children }: { children: React.ReactNode }) {
  const tabs: MailTab[] = [];

  // Without Supabase configured there is no session to resolve; render the
  // children bare and let each page show its own "not configured" notice.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const user = await requireUser();
    const permissions = await getEffectivePermissions(user.id);

    if (hasPermission(permissions, "communication:inbound:read")) {
      tabs.push({ href: "/mail/inbox", label: "Boîte de réception" });
    }
    if (hasPermission(permissions, "communication:read")) {
      // EMP-3 — drafting authority, not sending: a user who may compose but
      // not send still needs the surface, and Send is gated separately.
      tabs.push({ href: "/mail/compose", label: "Nouveau message" });
      tabs.push({ href: "/mail/drafts", label: "Brouillons" });
      tabs.push({ href: "/mail/sent", label: "Envoyés" });
      // "Boîtes aux lettres" HERE means "the mailboxes I may use" — a reading of
      // this user's own memberships. The company-wide mailbox administration of
      // the same name lives under Administration and is a different surface with
      // a different authority. Same words, different question.
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

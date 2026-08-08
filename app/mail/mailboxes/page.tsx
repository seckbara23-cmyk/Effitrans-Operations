import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listUserMemberships } from "@/lib/ec/mailboxes/membership";

export const metadata: Metadata = { title: "Boîtes aux lettres" };
export const dynamic = "force-dynamic";

/**
 * Enterprise Mail → Boîtes aux lettres (EMPLOYEE).
 *
 * EMP-IA-1. This route previously rendered the company-wide mailbox
 * administration and capture-health dashboard, gated on `communication:manage`
 * — an operator's surface sitting inside the workspace employees use to do
 * email. That content moved to Administration → Enterprise Mail; the route
 * itself is kept, because it is linked and bookmarked, and now answers the
 * question an employee is actually asking here:
 *
 *   "Which mailboxes may I use, and what may I do in them?"
 *
 * It is a READING of this user's own memberships (EMP-4A's `ec_mailbox_member`)
 * — no second mailbox model, no new service, no new permission. Membership is
 * the same record the administration surface writes; only the question differs.
 *
 * Gate: `communication:read`. A user who may use mail may see which mailboxes
 * they hold. It deliberately does NOT require `communication:manage`, which is
 * administrative authority and would put this back where it started.
 */
export default async function MyMailboxesPage() {
  const header = (
    <PageHeader
      meta="Enterprise Mail"
      title="Boîtes aux lettres"
      subtitle="Les boîtes auxquelles vous avez accès, et ce que vous pouvez y faire."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="space-y-6">
        {header}
        <div className="surface p-6 text-sm text-slate-600">Configuration requise.</div>
      </div>
    );
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:read")) notFound();

  // Administrators reach the company-wide surface from here; everyone else is
  // not shown a link they cannot open.
  const canAdminister = hasPermission(permissions, "communication:mailbox:provision")
    || hasPermission(permissions, "communication:membership:manage");
  const canOperate = hasPermission(permissions, "communication:manage");

  const memberships = (await listUserMemberships(user.tenantId, user.id))
    .filter((m) => !m.revokedAt);

  const cap = (on: boolean, label: string) => (
    <span
      key={label}
      className={on
        ? "rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700"
        : "rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400"}
    >
      {label}
    </span>
  );

  return (
    <div className="space-y-6">
      {header}

      {memberships.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">
          Aucune boîte ne vous est attribuée. L&apos;accès à une boîte partagée est accordé par
          un administrateur — il n&apos;est pas demandé depuis cette page.
        </div>
      ) : (
        <ul className="surface divide-y divide-slate-100">
          {memberships.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-navy-900">{m.address}</p>
                <p className="text-[11px] text-slate-500">
                  {m.labelFr}
                  {m.isDefaultSender ? " · expéditeur par défaut" : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {cap(m.canRead, "Lecture")}
                {cap(m.canSend, "Envoi")}
                {cap(m.canManageMembers, "Gestion des membres")}
                {canOperate ? (
                  <Link
                    href={`/mail/mailboxes/${m.mailboxId}`}
                    className="ml-1 text-[11px] text-teal-700 hover:underline"
                  >
                    Détail
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* The honesty line. Sender identity is EMP-4B's subject, not this one. */}
      <p className="surface p-4 text-[11px] text-slate-600">
        La capacité « envoi » autorise à initier une correspondance rattachée à une boîte dans
        Effitrans. Elle ne modifie pas l&apos;expéditeur vu par le destinataire : les messages
        sortants utilisent l&apos;expéditeur configuré de façon centrale.
      </p>

      {canAdminister ? (
        <p className="text-xs text-slate-500">
          Administration des boîtes de l&apos;entreprise :{" "}
          <Link href="/users/enterprise-mail" className="text-teal-700 hover:underline">
            Administration → Enterprise Mail
          </Link>
        </p>
      ) : null}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { listUserMemberships, listMailboxSummaries } from "@/lib/ec/mailboxes/membership";
import { eligibleMailboxes } from "@/lib/ec/mailboxes/eligibility";
import { UserMailboxPanel } from "@/components/ec/user-mailbox-panel";

export const metadata: Metadata = { title: "Enterprise Mail — utilisateur" };
export const dynamic = "force-dynamic";

/**
 * Administration → Utilisateurs → [Utilisateur] → Enterprise Mail.
 *
 * The onboarding surface: everything a new employee needs, in the place an
 * administrator already is after creating them. It reads what IS, and proposes
 * what MIGHT be — it never assigns anything on its own.
 *
 * Recommendations come from the user's role-derived department (Phase 9.0A:
 * departments are derived from roles, there is no column) and are suggestions,
 * not authorization decisions. Every membership row names the administrator who
 * granted it, which is only true if a person chose.
 */
export default async function UserEnterpriseMailPage({ params }: { params: { id: string } }) {
  const actor = await requireUser();
  const permissions = await getEffectivePermissions(actor.id);
  const canManageMembers = hasPermission(permissions, "communication:membership:manage");
  const canProvision = hasPermission(permissions, "communication:mailbox:provision");
  if (!canManageMembers && !canProvision) notFound();

  const admin = getAdminSupabaseClient();
  const { data: target } = await admin
    .from("app_user")
    .select("id, name, email, status")
    .eq("id", params.id)
    .eq("tenant_id", actor.tenantId)
    .maybeSingle();
  if (!target) notFound();
  const u = target as unknown as { id: string; name: string | null; email: string; status: string };

  const { data: roleRows } = await admin
    .from("user_role")
    .select("role:role_id(code)")
    .eq("user_id", params.id);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const roleCodes = ((roleRows ?? []) as any[])
    .map((r) => (Array.isArray(r.role) ? r.role[0]?.code : r.role?.code))
    .filter(Boolean) as string[];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const [memberships, mailboxes] = await Promise.all([
    listUserMemberships(actor.tenantId, params.id),
    listMailboxSummaries(actor.tenantId),
  ]);

  // Suggestions, minus what they already have.
  //
  // EMP-5E — matched on `department_eligibility`, the controlled key, NOT on
  // `purpose`. This was the SECOND place a free-text label decided who was
  // offered a mailbox, and it failed the same way: a mailbox labelled
  // `Operations` was proposed to nobody while looking perfectly healthy.
  //
  // PERSONAL is excluded because a personal mailbox belongs primarily to one
  // person; SHARED and FUNCTIONAL are both legitimately staffed by a department.
  // A mailbox with NULL eligibility matches nothing here — it is assigned by
  // hand, which the manual picker below still allows.
  const held = new Set(memberships.filter((m) => !m.revokedAt).map((m) => m.mailboxId));
  const assignable = mailboxes.filter((m) => m.mailboxType !== "PERSONAL");
  const suggestions = eligibleMailboxes(roleCodes)
    .map((e) => {
      const mailbox = assignable.find(
        (m) => m.departmentEligibility === e.eligibility && !held.has(m.id),
      );
      return mailbox ? { ...e, mailboxId: mailbox.id, address: mailbox.address,
                         status: mailbox.provisioningStatus } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const personal = mailboxes.find((m) => m.mailboxType === "PERSONAL" && m.ownerUserId === params.id) ?? null;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap gap-4">
        <Link href={`/users/${params.id}`} className="text-sm text-teal-700 hover:underline">
          ← Fiche utilisateur
        </Link>
        <Link href="/admin/enterprise-mail/access" className="text-sm text-teal-700 hover:underline">
          Administration Enterprise Mail
        </Link>
      </div>

      <PageHeader
        meta="Administration · Utilisateurs"
        title={`Enterprise Mail — ${u.name ?? u.email}`}
        subtitle={roleCodes.length > 0
          ? `Rôles : ${roleCodes.join(", ")}`
          : "Aucun rôle assigné — aucune boîte ne peut être proposée."}
      />

      <UserMailboxPanel
        userId={params.id}
        userLabel={u.name ?? u.email}
        memberships={memberships}
        suggestions={suggestions}
        personal={personal}
        allMailboxes={assignable}
        canManageMembers={canManageMembers}
        canProvision={canProvision}
      />
    </div>
  );
}

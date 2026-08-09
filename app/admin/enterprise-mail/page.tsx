import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";

/**
 * Administration → Administration Mail — the landing router.
 *
 * THE DEFECT THIS EXISTS TO FIX. The sidebar entry is visible to a holder of
 * ANY of three permissions, because the four surfaces behind it are governed by
 * three different ones. It used to point straight at the mailbox administration
 * page, which accepts only two of them — so a holder of `communication:manage`
 * alone (SYSTEM_ADMIN, OPS_SUPERVISOR) saw the entry, clicked it, and got a
 * 404 from the page's own `notFound()`. The route existed; the authority to
 * open it did not.
 *
 * A landing route must therefore be a ROUTER, not a page: it sends each holder
 * to the first surface their authority actually opens, in the order the ratified
 * IA lists them. The rule that makes it correct is that this router grants
 * nothing — every destination still enforces its own gate, and a caller holding
 * none of the three lands on the same 404 as before, which is the right answer.
 *
 * The same shape as /mail's router, and for the same reason: a front door that
 * can 404 the people it is shown to is a broken front door.
 */
export default async function EnterpriseMailAdminLandingPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/admin/enterprise-mail/mailboxes");

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);

  // Ordered as the IA reads: access, then mailboxes, then operations.
  if (hasPermission(permissions, "communication:membership:manage")) {
    redirect("/admin/enterprise-mail/access");
  }
  if (hasPermission(permissions, "communication:mailbox:provision")) {
    redirect("/admin/enterprise-mail/mailboxes");
  }
  if (hasPermission(permissions, "communication:manage")) {
    redirect("/admin/enterprise-mail/capture");
  }

  // Holds no mail-administration authority at all. This is the correct 404 —
  // the one the sidebar should never have offered in the first place.
  notFound();
}

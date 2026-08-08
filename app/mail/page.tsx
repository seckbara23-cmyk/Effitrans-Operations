import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";

/**
 * Enterprise Mail — the landing router.
 *
 * Until EMP-IA-1 this route WAS the outbound journal, which put queue state and
 * provider failures at the front door of a mail client. The journal moved to
 * Administration → Enterprise Mail → « Journal technique des envois »; `/mail`
 * now sends the user to the first surface they can actually use.
 *
 * WHY THIS IS CONDITIONAL RATHER THAN A FIXED REDIRECT TO THE INBOX.
 * The inbox is gated on `communication:inbound:read`, which RATIFY-EC1-1 grants
 * to NO role — deliberately, and EMP-IA-1 is not the phase that changes it. A
 * hard redirect to /mail/inbox would therefore 404 for every user on the
 * platform today. So the inbox is preferred when it is reachable, and the
 * compose surface is the fallback when it is not.
 *
 * This grants nothing. It only avoids sending people to a door they cannot open.
 */
export default async function EnterpriseMailLandingPage() {
  // No session to resolve without Supabase; the workspace pages each render
  // their own "not configured" notice, so send the user to one of them.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/mail/compose");

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);

  if (hasPermission(permissions, "communication:inbound:read")) redirect("/mail/inbox");
  if (hasPermission(permissions, "communication:read")) redirect("/mail/compose");

  // Holds no mail authority at all. /mail/compose gates itself and will 404,
  // which is the correct answer — this router does not invent an exception.
  redirect("/mail/compose");
}

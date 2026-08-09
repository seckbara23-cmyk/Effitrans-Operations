import { permanentRedirect } from "next/navigation";

/**
 * Legacy route — inbound capture state.
 *
 * ADMIN-MAIL-ROUTING moved mail administration out of /users, where it had been
 * a child of the general user-management module and was therefore highlighting
 * « Utilisateurs » in the sidebar at the same time as itself. Its canonical home
 * is now /admin/enterprise-mail/*.
 *
 * This redirect exists because /users/enterprise-mail shipped in EMP-4A and is
 * linked from operator documentation and deployment notes. Breaking it silently
 * would turn a bookmark into the same 404 this phase was opened to fix.
 *
 * `permanentRedirect` (308) rather than a temporary one: the move is permanent,
 * and it lets clients and crawlers stop asking. No loop is possible — the target
 * is a different path prefix and never redirects back here.
 */
export default function LegacyMailAdminRedirect(): never {
  permanentRedirect("/admin/enterprise-mail/capture");
}

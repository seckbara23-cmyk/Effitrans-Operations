/**
 * Messaging Center notification fan-out (Phase 8.7). SERVER-ONLY (internal).
 * ---------------------------------------------------------------------------
 * Reuses the TWO existing notification tables rather than inventing a third:
 * staff -> public.notification (createNotification), portal -> public.client_notification
 * (a direct insert here, NOT the templated notifyCustomer() pipeline — a message body
 * is free-text user content, not one of the fixed lifecycle-event templates that
 * pipeline renders). Best-effort throughout: a notification failure must never fail
 * the message send itself.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";
import { reportError } from "@/lib/observability/report";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/**
 * Every ACTIVE app_user in this tenant holding the given permission code. Plain,
 * separately-run queries (not a nested reverse-relation embed) — matches the join-
 * in-JS style already used by lib/users/service.ts's listUsers().
 */
export async function resolveStaffWithPermission(admin: Admin, tenantId: string, permissionCode: string): Promise<string[]> {
  const { data: perm } = await admin.from("permission").select("id").eq("code", permissionCode).maybeSingle();
  if (!perm) return [];

  const { data: rolePerms } = await admin.from("role_permission").select("role_id").eq("permission_id", perm.id);
  const grantedRoleIds = [...new Set((rolePerms ?? []).map((r) => r.role_id))];
  if (grantedRoleIds.length === 0) return [];

  const { data: roles } = await admin.from("role").select("id").eq("tenant_id", tenantId).in("id", grantedRoleIds);
  const tenantRoleIds = (roles ?? []).map((r) => r.id);
  if (tenantRoleIds.length === 0) return [];

  const { data: userRoles } = await admin.from("user_role").select("user_id").in("role_id", tenantRoleIds);
  const userIds = [...new Set((userRoles ?? []).map((u) => u.user_id))];
  if (userIds.length === 0) return [];

  const { data: activeUsers } = await admin.from("app_user").select("id").in("id", userIds).eq("status", "active");
  return (activeUsers ?? []).map((u) => u.id);
}

/** Notify every OTHER staff participant + (for customer_support) department-permission holders. */
export async function notifyStaffOfMessage(input: {
  admin: Admin;
  tenantId: string;
  conversationId: string;
  excludeUserId: string | null;
  recipientUserIds: string[];
  title: string;
  body: string;
}): Promise<void> {
  const recipients = new Set(input.recipientUserIds.filter((id) => id !== input.excludeUserId));
  for (const userId of recipients) {
    try {
      await createNotification({
        tenantId: input.tenantId,
        userId,
        type: "MESSAGE_RECEIVED",
        title: input.title,
        body: input.body,
      });
    } catch (e) {
      reportError(e, { scope: "action", event: "messaging.notify_staff" });
    }
  }
}

/**
 * Portal inbox notification for a staff reply. Direct insert — see module header.
 * Not separately audited: the sending action already writes MESSAGING_MESSAGE_SENT
 * with the real staff actor, exactly like createNotification() (the staff-side
 * equivalent) is itself never separately audited either.
 */
export async function notifyPortalOfMessage(input: {
  admin: Admin;
  tenantId: string;
  clientId: string;
  conversationId: string;
  fileId: string | null;
  title: string;
  body: string;
  messageId: string;
}): Promise<void> {
  try {
    await input.admin.from("client_notification").insert({
      tenant_id: input.tenantId,
      client_id: input.clientId,
      event_type: "messaging.message_received",
      category: "message",
      title: input.title,
      body: input.body,
      file_id: input.fileId,
      conversation_id: input.conversationId,
      // One notification per message: the message id is already globally unique,
      // unlike lifecycle events which dedup repeats of the SAME event.
      dedup_key: `messaging:${input.messageId}`,
    });
  } catch (e) {
    reportError(e, { scope: "action", event: "messaging.notify_portal" });
  }
}

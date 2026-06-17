"use server";

/**
 * Portal notification actions (Phase 2.5). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Mark-read + notification preferences for the authenticated portal user.
 * Writes via the service-role admin client, scoped to the caller's own client /
 * own client_user row (ownership verified from the portal session). No delete.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentPortalUser } from "@/lib/portal/auth";
import type { EmailPrefs } from "./events";

export type PortalActionResult = { ok: boolean };

export async function markClientNotificationRead(id: string): Promise<PortalActionResult> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false };
  const admin = getAdminSupabaseClient();
  await admin
    .from("client_notification")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", user.clientId)
    .is("read_at", null);
  return { ok: true };
}

export async function markAllClientNotificationsRead(): Promise<PortalActionResult> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false };
  const admin = getAdminSupabaseClient();
  await admin
    .from("client_notification")
    .update({ read_at: new Date().toISOString() })
    .eq("client_id", user.clientId)
    .is("read_at", null);
  return { ok: true };
}

export async function getNotificationPrefs(): Promise<EmailPrefs | null> {
  const user = await getCurrentPortalUser();
  if (!user) return null;
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("client_user")
    .select("notify_email, notify_shipment, notify_invoice, notify_payment")
    .eq("id", user.id)
    .maybeSingle<EmailPrefs>();
  return data ?? null;
}

export async function updateNotificationPrefs(prefs: EmailPrefs): Promise<PortalActionResult> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false };
  const admin = getAdminSupabaseClient();
  await admin
    .from("client_user")
    .update({
      notify_email: Boolean(prefs.notify_email),
      notify_shipment: Boolean(prefs.notify_shipment),
      notify_invoice: Boolean(prefs.notify_invoice),
      notify_payment: Boolean(prefs.notify_payment),
    })
    .eq("id", user.id);
  return { ok: true };
}

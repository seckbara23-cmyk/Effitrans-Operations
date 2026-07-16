/**
 * Executive — customer-notification KPIs (Phase 7.7). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * NARROWLY SCOPED BY DESIGN. The audit found that portal adoption KPIs ALREADY have an
 * authoritative source: getAnalytics() → `portal: PortalKpis` (users, activeClients,
 * sharedDocuments, downloads, invoiceViews — lib/analytics/calc.ts computePortal). The executive
 * dashboard REUSES that and this module does NOT recompute any of it.
 *
 * The only genuinely missing figures are the notification ones — no reader anywhere answers "how
 * many customer notifications did this tenant deliver, and how many are still unread?"
 * (listClientNotifications is customer-scoped through portal RLS, by design). This module fills
 * exactly that gap and nothing else.
 *
 * It duplicates NO business logic: two COUNTs over the notification table's own rows. Notification
 * semantics (what gets sent, dedup, templating) stay entirely in lib/customer-notify/*.
 *
 * BOUNDED BY CONSTRUCTION: two `head: true` COUNT queries over an indexed (tenant, …) predicate —
 * no row bodies, no titles, no message content, no per-customer scan, no N+1. These are
 * organization aggregates: no individual customer is identified.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";

const DAY = 86_400_000;

export type NotificationKpis = {
  windowDays: number;
  delivered: number;
  unread: number;
};

/** Tenant-wide customer-notification aggregates. Counts only — never a message body. */
export async function readNotificationKpis(windowDays = 30): Promise<NotificationKpis> {
  const user = await assertPermission("executive:dashboard:read");
  const admin = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const since = new Date(Date.now() - windowDays * DAY).toISOString();

  const [deliveredRes, unreadRes] = await Promise.all([
    admin.from("client_notification").select("id", { count: "exact", head: true }).eq("tenant_id", tenant).gte("created_at", since),
    admin.from("client_notification").select("id", { count: "exact", head: true }).eq("tenant_id", tenant).is("read_at", null),
  ]);

  return {
    windowDays,
    delivered: deliveredRes.count ?? 0,
    unread: unreadRes.count ?? 0,
  };
}

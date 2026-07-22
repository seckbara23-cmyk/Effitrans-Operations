/**
 * Messaging Center dashboard summary (Phase 8.7). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Derived counts only — no SLA/compliance metric is invented here (there is not
 * enough real response-time history yet to claim one honestly). Gated on
 * messaging:manage, matching the "managers see the queue health" scope used
 * elsewhere (e.g. AdminPresenceCard on admin:users:manage).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getEffectivePermissions } from "@/lib/rbac/permissions";

export type MessagingDashboardSummary = {
  openRequests: number;
  waitingEffitrans: number;
  waitingCustomer: number;
  urgentOpen: number;
};

export async function getMessagingDashboardSummary(userId: string, tenantId: string): Promise<MessagingDashboardSummary | null> {
  const permissions = await getEffectivePermissions(userId);
  if (!permissions.includes("messaging:manage")) return null;

  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("conversation")
    .select("status, priority")
    .eq("tenant_id", tenantId)
    .eq("type", "customer_support")
    .neq("status", "closed")
    .returns<{ status: string; priority: string }[]>();

  const rows = data ?? [];
  return {
    openRequests: rows.length,
    waitingEffitrans: rows.filter((r) => r.status === "waiting_effitrans" || r.status === "open").length,
    waitingCustomer: rows.filter((r) => r.status === "waiting_customer").length,
    urgentOpen: rows.filter((r) => r.priority === "urgent").length,
  };
}

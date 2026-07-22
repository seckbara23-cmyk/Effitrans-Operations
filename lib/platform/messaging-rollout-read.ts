/**
 * Messaging Center rollout overview for the platform console (Phase 8.7). SERVER-ONLY.
 * Mirrors lib/platform/rollout-read.ts's shape for the independent messaging flag.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { messagingGlobalKillSwitch } from "@/lib/messaging/rollout";

export type MessagingRolloutRow = {
  tenantId: string;
  companyName: string;
  slug: string | null;
  enabled: boolean;
  /** What is ACTUALLY live: the kill switch ANDed with the tenant row. */
  effective: boolean;
  note: string | null;
  firstEnabledAt: string | null;
  updatedAt: string | null;
};

export type MessagingRolloutOverview = {
  killSwitchOn: boolean;
  rows: MessagingRolloutRow[];
  enabledCount: number;
};

export async function getMessagingRolloutOverview(): Promise<MessagingRolloutOverview> {
  const killSwitchOn = messagingGlobalKillSwitch();
  const admin = getAdminSupabaseClient();

  const [{ data: orgs }, { data: rollouts }] = await Promise.all([
    admin.from("organization").select("id, name, slug").order("name"),
    admin.from("tenant_messaging_rollout").select("tenant_id, enabled, note, first_enabled_at, updated_at"),
  ]);

  const byTenant = new Map((rollouts ?? []).map((r) => [r.tenant_id, r]));

  const rows: MessagingRolloutRow[] = (orgs ?? []).map((o) => {
    const raw = byTenant.get(o.id) ?? null;
    const enabled = raw?.enabled === true;
    return {
      tenantId: o.id,
      companyName: o.name ?? "—",
      slug: o.slug ?? null,
      enabled,
      effective: killSwitchOn && enabled,
      note: raw?.note ?? null,
      firstEnabledAt: raw?.first_enabled_at ?? null,
      updatedAt: raw?.updated_at ?? null,
    };
  });

  return { killSwitchOn, rows, enabledCount: rows.filter((r) => r.effective).length };
}

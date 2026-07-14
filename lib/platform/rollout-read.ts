/**
 * Rollout overview for the platform console (Phase 5.0E-2A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read side of the tenant rollout. Platform-scoped: it deliberately crosses tenant
 * boundaries (that is the whole job of a platform console), so it exposes ONLY
 * rollout state and company identity — never any operational or customer data.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProcessFlags } from "@/lib/process/config";
import { normalizeRollout, type TenantRollout } from "@/lib/process/rollout";
import type { ProcessFlags } from "@/lib/process/flags";

export type TenantRolloutRow = {
  tenantId: string;
  companyName: string;
  /** The slug the diagnostics report. Lets an operator match console to page. */
  slug: string | null;
  lifecycleStatus: string;
  createdAt: string | null;
  rollout: TenantRollout;
  /** What is ACTUALLY live for this tenant: the kill switch ANDed with the row. */
  effective: TenantRollout;
  note: string | null;
  firstEnabledAt: string | null;
  updatedAt: string | null;
};

export type RolloutOverview = {
  /** The deployment kill switch. Nothing is live for anyone if `enabled` is false. */
  killSwitch: ProcessFlags;
  rows: TenantRolloutRow[];
  enabledCount: number;
};

export async function getRolloutOverview(): Promise<RolloutOverview> {
  const killSwitch = getProcessFlags();
  const admin = getAdminSupabaseClient();

  const [{ data: orgs }, { data: rollouts }] = await Promise.all([
    admin
      .from("organization")
      .select("id, name, slug, lifecycle_status, created_at")
      .order("name"),
    admin
      .from("tenant_process_rollout")
      // Literal, not a template: the Supabase type parser reads the select string at
      // compile time and cannot see through an interpolation.
      .select(
        "tenant_id, process_engine, process_workspaces, physical_invoice_deposit, collections, note, first_enabled_at, updated_at",
      ),
  ]);

  const byTenant = new Map(
    ((rollouts ?? []) as Record<string, unknown>[]).map((r) => [r.tenant_id as string, r]),
  );

  const rows: TenantRolloutRow[] = ((orgs ?? []) as Record<string, unknown>[]).map((o) => {
    const raw = byTenant.get(o.id as string) ?? null;
    const rollout = normalizeRollout(raw);

    // The number that matters. A tenant row saying "on" means nothing while the
    // deployment kill switch is off — the console must show what is LIVE, not what
    // someone once ticked.
    const effective: TenantRollout = {
      process_engine: killSwitch.enabled && rollout.process_engine,
      process_workspaces: killSwitch.workspaces && rollout.process_engine && rollout.process_workspaces,
      physical_invoice_deposit:
        killSwitch.physicalDeposit && rollout.process_engine && rollout.physical_invoice_deposit,
      collections: killSwitch.collections && rollout.process_engine && rollout.collections,
    };

    return {
      tenantId: o.id as string,
      companyName: (o.name as string) ?? "—",
      slug: (o.slug as string) ?? null,
      lifecycleStatus: (o.lifecycle_status as string) ?? "ACTIVE",
      createdAt: (o.created_at as string) ?? null,
      rollout,
      effective,
      note: (raw?.note as string) ?? null,
      firstEnabledAt: (raw?.first_enabled_at as string) ?? null,
      updatedAt: (raw?.updated_at as string) ?? null,
    };
  });

  return {
    killSwitch,
    rows,
    enabledCount: rows.filter((r) => r.effective.process_engine).length,
  };
}

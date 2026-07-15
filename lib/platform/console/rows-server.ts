/**
 * Console row assembly (Phase 6.0C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Joins the two existing bounded platform reads — listCompanies() and
 * getRolloutOverview() — into the ConsoleRow[] the console renders. Both reads are
 * already gated and already O(1)-in-tenant-count queries, so this adds NO N+1: it is
 * two reads and an in-memory join, whatever the tenant count.
 */
import "server-only";
import { listCompanies } from "@/lib/platform/companies";
import { getRolloutOverview } from "@/lib/platform/rollout-read";
import { buildConsoleRows, type ConsoleRow } from "./table";
import type { TenantRollout } from "@/lib/process/rollout";

export async function loadConsoleRows(now: number): Promise<{
  rows: ConsoleRow[];
  killSwitchEnabled: boolean;
}> {
  const [companies, overview] = await Promise.all([listCompanies(), getRolloutOverview()]);

  const byTenant = new Map<string, { rollout: TenantRollout; live: boolean }>();
  for (const r of overview.rows) {
    byTenant.set(r.tenantId, { rollout: r.rollout, live: r.effective.process_engine });
  }

  return {
    rows: buildConsoleRows(companies, byTenant, now),
    killSwitchEnabled: overview.killSwitch.enabled,
  };
}

/**
 * Centre d'Opérations — composition reader (Phase 10.0B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * THE cockpit composition point (DEC-B29: /dashboard evolved in place — this
 * layer feeds it from 10.0C on). Mirrors the proven executive pattern
 * (lib/executive/reader): every figure is produced by an EXISTING bounded
 * reader; this file only calls them, projects their output into the cockpit
 * model, and merges. CONSUME, NEVER OWN — no table read of its own (the two
 * NEW aggregations live in ./workload and ./finance-requests), no mutation,
 * no workflow state, no second state machine.
 *
 *   getFileOverview()             [file:read]        → dossier counts
 *   getDashboardTasks()           [task:read]        → today / overdue / mine
 *   getProcessTower(tenant,perms) [process:read+flag]→ ~30 stage counters
 *   getQueueCounts(tenant,perms)  [process:read]     → per-queue depth (workload rollup)
 *   getCommandCenter()            [transport:read]   → transit headline/cards/attention
 *   getControlTower(perms)        [analytics:read]   → executive KPI row
 *   getFinanceKpis()/getFinanceMonthRevenue()/getReconciliation()  [finance:read]
 *   getFinanceRequestQueue()      [finance:read+flag]→ NEW tenant-wide request pipeline
 *   getCollectionsQueue(...)      [collections:manage+flag] → open receivables count
 *   getMessagingDashboardSummary()[messaging:manage] → customer-support summary
 *   unreadStaffMessagingCount()   [RLS]              → viewer's unread badge
 *   getWorkloadByTeam/ByUser(...) [process:read / analytics:read (DEC-B30)]
 *
 * NO TOP-LEVEL PERMISSION GATE — deliberately. The cockpit is /dashboard, the
 * ungated landing page: each section is gated INDIVIDUALLY before its read
 * (zero queries and zero bytes for a section the viewer cannot see), each
 * composed reader still self-authorizes (defense in depth), and every failure
 * degrades to null under Promise.allSettled. Missing ≠ Negative.
 *
 * DEC-B31: request-driven only — no Realtime, no polling. React cache() means
 * a render that reads the cockpit more than once performs the work ONCE.
 */
import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getFileOverview } from "@/lib/files/service";
import { getDashboardTasks } from "@/lib/tasks/service";
import { getProcessTower } from "@/lib/process/queues/control-tower";
import { getQueueCounts } from "@/lib/process/queues/service";
import { getCommandCenter } from "@/lib/logistics/reader";
import { getControlTower } from "@/lib/control-tower/service";
import { getFinanceKpis, getReconciliation } from "@/lib/finance/service";
import { getFinanceMonthRevenue } from "@/lib/departments/service";
import { getCollectionsQueue } from "@/lib/collections/service";
import { getMessagingDashboardSummary } from "@/lib/messaging/dashboard";
import { unreadStaffMessagingCount } from "@/lib/messaging/service";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { mergeExecutiveAlerts, countAlertsByLevel } from "@/lib/executive/compose";
import { getFinanceRequestQueue } from "./finance-requests";
import { getWorkloadByTeam, getWorkloadByUser } from "./workload";
import { projectAttentionAlerts, reconciliationIndicators, rollupQueueDepths, taskKpis } from "./compose";
import type { CockpitSection, OperationsCockpit } from "./types";

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
const none = Promise.resolve(null);

export const getOperationsCockpit = cache(async (): Promise<OperationsCockpit> => {
  const user = await requireUser();
  const perms = await getEffectivePermissions(user.id);
  const canFinance = hasPermission(perms, "finance:read");
  const canTransit = hasPermission(perms, "transport:read");
  const canAnalytics = hasPermission(perms, "analytics:read");
  const canProcess = hasPermission(perms, "process:read");
  const canCollections = hasPermission(perms, "collections:manage");
  const flags = await getTenantProcessFlags(user.tenantId).catch(() => null);
  // Engine surfaces stay dark-by-default: kill switch + tenant flag, same as /my-work
  // (getQueueCounts itself does not flag-check — its existing page does; the cockpit must too).
  const engineLive =
    canProcess && globalKillSwitch().workspaces && flags?.enabled === true && flags?.workspaces === true;

  const generatedAt = new Date().toISOString();
  const sections: CockpitSection[] = [];
  const unavailable: CockpitSection[] = [];

  const [
    filesR, tasksR, towerR, countsR, ccR, ctR,
    finKpisR, revenueR, reconR, requestsR, collR,
    msgSummaryR, unreadR, teamR, userR,
  ] = await Promise.allSettled([
    getFileOverview(),
    getDashboardTasks(),
    canProcess ? getProcessTower(user.tenantId, perms) : none,
    engineLive ? getQueueCounts(user.tenantId, perms) : Promise.resolve<Record<string, number>>({}),
    canTransit ? getCommandCenter() : none,
    canAnalytics ? getControlTower(perms) : none,
    canFinance ? getFinanceKpis() : none,
    canFinance ? getFinanceMonthRevenue() : Promise.resolve<number | null>(null),
    canFinance ? getReconciliation() : none,
    canFinance ? getFinanceRequestQueue() : none,
    canCollections && flags?.collections
      ? getCollectionsQueue(user.tenantId, user.id, perms, {}, 1, 1)
      : none,
    getMessagingDashboardSummary(user.id, user.tenantId),
    unreadStaffMessagingCount(),
    getWorkloadByTeam(user.tenantId, perms),
    getWorkloadByUser(user.tenantId, perms),
  ]);

  // ---------------------------------------------------------------- operations ----
  const files = settled(filesR);
  const tasks = taskKpis(settled(tasksR));
  const processTower = settled(towerR);
  const operations = files || tasks || processTower ? { files, tasks, processTower } : null;
  (operations ? sections : unavailable).push("operations");

  // ---------------------------------------------------------------- transit ----
  const cc = settled(ccR);
  const transit = cc
    ? {
        headline: cc.headline,
        cards: cc.cards,
        upcomingCount: cc.upcoming.length,
        customsAuthorized: cc.customsAuthorized,
      }
    : null;
  (transit ? sections : unavailable).push("transit");

  // ---------------------------------------------------------------- finance ----
  const ct = settled(ctR);
  const invoices = settled(finKpisR);
  const recon = settled(reconR);
  const requests = settled(requestsR);
  const collections = settled(collR);
  const currency = ct?.kpis.currency ?? "XOF";
  // No finance:read (or every finance read failed) ⇒ the section is ABSENT, never zero revenue.
  const finance =
    canFinance && (invoices || recon || requests || settled(revenueR) != null)
      ? {
          invoices,
          revenueThisMonth: settled(revenueR),
          reconciliation: reconciliationIndicators(recon),
          requests,
          collectionsOpen: collections ? collections.total : null,
          currency,
        }
      : null;
  (finance ? sections : unavailable).push("finance");

  // ---------------------------------------------------------------- messaging ----
  const unread = settled(unreadR);
  const messaging = unread != null ? { unread, summary: settled(msgSummaryR) } : null;
  (messaging ? sections : unavailable).push("messaging");

  // ---------------------------------------------------------------- alerts ----
  // The SAME two-tier engine the executive dashboard uses: each module's own alert
  // engine → Command Center mergeAttention → normalize + mergeExecutiveAlerts.
  // 10.0E widens the ingested producers (adapters); the merge itself is final.
  const alerts = cc
    ? (() => {
        const items = mergeExecutiveAlerts(projectAttentionAlerts(cc.attention));
        return { items, counts: countAlertsByLevel(items) };
      })()
    : null;
  (alerts ? sections : unavailable).push("alerts");

  // ---------------------------------------------------------------- KPIs ----
  const kpis = ct ? { executive: ct.kpis } : null;
  (kpis ? sections : unavailable).push("kpis");

  // ---------------------------------------------------------------- workload ----
  const counts = settled(countsR) ?? {};
  const { byDepartment, byQueue } = rollupQueueDepths(counts);
  const byTeam = settled(teamR);
  const byUser = settled(userR);
  // Available only when the engine is live for this viewer: aggregated rows need
  // process:read + the workspaces flags; byUser alone (analytics:read) also counts.
  const workload = engineLive || byUser ? { byDepartment, byQueue, byTeam, byUser } : null;
  (workload ? sections : unavailable).push("workload");

  return {
    generatedAt,
    sections,
    unavailable,
    operations,
    transit,
    finance,
    messaging,
    alerts,
    kpis,
    workload,
    canFinance,
    currency,
  };
});

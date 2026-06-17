/**
 * Department dashboard cards (Dashboard UX). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Assembles the "Activité par département" cards by REUSING the Phase 2.0
 * services + classifiers + handoff counts — no duplicated business logic. Only
 * the departments the viewer is permitted to read are queried (each service also
 * re-asserts its own permission). Best-effort: a failing dept is dropped, not
 * fatal to the dashboard.
 */
import "server-only";
import { hasPermission } from "@/lib/rbac/check";
import { getDocumentationQueue } from "./service";
import { getCustomsQueue } from "@/lib/customs/service";
import { getTransportQueue } from "@/lib/transport/service";
import { getFinanceKpis, getReconciliation } from "@/lib/finance/service";
import { getAnalytics } from "@/lib/analytics/service";
import { readyForCustomsCount } from "@/lib/handoffs/service";
import { documentationCards, customsCards, transportCards } from "./classify";
import {
  documentationCardData,
  customsCardData,
  transportCardData,
  financeCardData,
  managementCardData,
  type DepartmentCardData,
} from "./dashboard-map";

export async function getDepartmentCards(permissions: string[]): Promise<DepartmentCardData[]> {
  const can = (p: string) => hasPermission(permissions, p);
  const jobs: Promise<DepartmentCardData>[] = [];
  if (can("document:read")) jobs.push(docCard());
  if (can("customs:read")) jobs.push(customsCard());
  if (can("transport:read")) jobs.push(transportCard());
  if (can("finance:read")) jobs.push(financeCard());
  if (can("analytics:read")) jobs.push(mgmtCard(can("finance:read")));
  const results = await Promise.all(jobs.map((j) => j.catch(() => null)));
  return results.filter((c): c is DepartmentCardData => c != null);
}

async function docCard(): Promise<DepartmentCardData> {
  const [rows, ready] = await Promise.all([getDocumentationQueue(), readyForCustomsCount()]);
  return documentationCardData(documentationCards(rows), ready);
}

async function customsCard(): Promise<DepartmentCardData> {
  const rows = await getCustomsQueue();
  const blocked = rows.filter((r) => r.status === "BLOCKED").length;
  return customsCardData(customsCards(rows), blocked);
}

async function transportCard(): Promise<DepartmentCardData> {
  const rows = await getTransportQueue();
  return transportCardData(transportCards(rows));
}

async function financeCard(): Promise<DepartmentCardData> {
  const [kpis, recon] = await Promise.all([getFinanceKpis(), getReconciliation()]);
  return financeCardData({ issued: kpis.issuedCount, overdue: kpis.overdueCount }, recon.counts.pending);
}

async function mgmtCard(canFinance: boolean): Promise<DepartmentCardData> {
  const a = await getAnalytics(canFinance);
  return managementCardData({
    active: a.operations.active,
    highPriority: a.operations.highPriority,
    blocked: a.operations.blocked,
  });
}

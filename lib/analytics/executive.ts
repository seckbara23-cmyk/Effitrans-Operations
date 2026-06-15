/**
 * Executive analytics layer (Phase 1.13B) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Presentation / decision-support ONLY. Adds health, alerts, scorecard, 12-month
 * trends, collections, top clients, and route activity DERIVED from existing
 * data. Does NOT change any Phase-1.13 KPI calculation, service, or model.
 */
import { revenueTrend } from "./calc";
import type { AnalyticsData, Bar, InvoiceAgg, TrendPoint } from "./types";

export type ExecutiveHealth = "GREEN" | "AMBER" | "RED";
export type AlertLevel = "RED" | "AMBER" | "GREEN";
export type Alert = { level: AlertLevel; key: string; count: number };
export type Scorecard = {
  operations: number;
  customs: number;
  transport: number;
  collections: number | null;
  overall: number;
};
export type ExecBanner = {
  revenueThisMonth: number | null;
  activeDossiers: number;
  inTransit: number;
  outstanding: number | null;
};
export type CollectionPoint = { month: string; issued: number; paid: number };
export type TopClient = { clientName: string; revenue: number; dossiers: number };
export type RouteActivity = { route: string; count: number };

export type ExecutiveData = {
  lastUpdated: string;
  health: ExecutiveHealth;
  banner: ExecBanner;
  alerts: Alert[];
  scorecard: Scorecard;
  revenue12: TrendPoint[] | null;
  collections12: CollectionPoint[] | null;
  newDossiers12: TrendPoint[];
  topClients: TopClient[] | null;
  routes: RouteActivity[];
};

const ISSUED = new Set(["ISSUED", "PARTIALLY_PAID", "PAID"]);
const OPEN = new Set(["ISSUED", "PARTIALLY_PAID"]);
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (bars: Bar[]) => bars.reduce((s, b) => s + b.value, 0);

function monthKeys(now: Date, months: number): string[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

// ------------------------------------------------------------------ health ----

/** GREEN: nothing wrong · RED: significant overdue OR multiple blocked · AMBER: some. */
export function computeHealth(overdueCount: number, blockedCount: number): ExecutiveHealth {
  if (overdueCount === 0 && blockedCount === 0) return "GREEN";
  if (overdueCount >= 5 || blockedCount >= 2) return "RED";
  return "AMBER";
}

export function buildAlerts(input: {
  overdueCount: number;
  blockedCustoms: number;
  blockedTransport: number;
  transportsOverdue: number;
}): Alert[] {
  const alerts: Alert[] = [];
  if (input.overdueCount > 0)
    alerts.push({ level: input.overdueCount >= 5 ? "RED" : "AMBER", key: "overdueInvoices", count: input.overdueCount });
  if (input.blockedCustoms > 0)
    alerts.push({ level: input.blockedCustoms >= 2 ? "RED" : "AMBER", key: "blockedCustoms", count: input.blockedCustoms });
  if (input.blockedTransport > 0)
    alerts.push({ level: input.blockedTransport >= 2 ? "RED" : "AMBER", key: "blockedTransport", count: input.blockedTransport });
  if (input.transportsOverdue > 0)
    alerts.push({ level: "AMBER", key: "transportsOverdue", count: input.transportsOverdue });
  if (alerts.length === 0) alerts.push({ level: "GREEN", key: "allClear", count: 0 });
  return alerts;
}

// --------------------------------------------------------------- scorecard ----

/** Simple, informational 0–100 scores derived from the existing KPIs. */
export function computeScorecard(a: AnalyticsData): Scorecard {
  const totalFiles = sum(a.charts.statusDistribution);
  const totalCustoms = sum(a.charts.customsPipeline);
  const totalTransport = sum(a.charts.transportPipeline);

  const opsBase = totalFiles > 0 ? (100 * (a.operations.delivered + a.operations.closed)) / totalFiles : 100;
  const operations = clamp(round(opsBase - Math.min(a.operations.blocked * 5, 30)));

  const customs = totalCustoms > 0 ? clamp(round((100 * a.customs.released) / totalCustoms)) : 100;

  const pod = totalTransport > 0 ? (100 * a.transport.podReceived) / totalTransport : 0;
  const transport =
    totalTransport === 0
      ? 100
      : clamp(round(a.transport.onTimePct != null ? (pod + a.transport.onTimePct) / 2 : pod));

  let collections: number | null = null;
  if (a.financial) {
    const overdueRatio = a.financial.outstanding > 0 ? clamp(a.financial.overdue / a.financial.outstanding, 0, 1) : 0;
    collections = clamp(round(a.financial.collectionRate - overdueRatio * 30));
  }

  const scores = [operations, customs, transport, ...(collections != null ? [collections] : [])];
  const overall = clamp(round(scores.reduce((s, v) => s + v, 0) / scores.length));
  return { operations, customs, transport, collections, overall };
}

// ----------------------------------------------------------------- trends -----

export function revenue12(invoices: InvoiceAgg[], now: Date): TrendPoint[] {
  return revenueTrend(invoices, now, 12);
}

export function newDossiersPerMonth(files: { created_at: string }[], now: Date, months = 12): TrendPoint[] {
  const keys = monthKeys(now, months);
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const f of files) {
    const k = f.created_at.slice(0, 7);
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return keys.map((month) => ({ month, value: counts.get(month) ?? 0 }));
}

export function collectionsTrend(
  invoices: InvoiceAgg[],
  payments: { amount: number; paidAt: string | null; reversed: boolean }[],
  now: Date,
  months = 12,
): CollectionPoint[] {
  const keys = monthKeys(now, months);
  const issued = new Map(keys.map((k) => [k, 0]));
  const paid = new Map(keys.map((k) => [k, 0]));
  for (const inv of invoices) {
    if (!ISSUED.has(inv.status) || !inv.issueDate) continue;
    const k = inv.issueDate.slice(0, 7);
    if (issued.has(k)) issued.set(k, round2(issued.get(k)! + inv.total));
  }
  for (const p of payments) {
    if (p.reversed || !p.paidAt) continue;
    const k = p.paidAt.slice(0, 7);
    if (paid.has(k)) paid.set(k, round2(paid.get(k)! + p.amount));
  }
  return keys.map((month) => ({ month, issued: issued.get(month) ?? 0, paid: paid.get(month) ?? 0 }));
}

export function topClients(
  invoices: InvoiceAgg[],
  files: { client_id: string | null }[],
  clientNames: Record<string, string>,
  top = 10,
): TopClient[] {
  const revenue = new Map<string, number>();
  for (const inv of invoices) {
    if (!ISSUED.has(inv.status) || !inv.clientId) continue;
    revenue.set(inv.clientId, round2((revenue.get(inv.clientId) ?? 0) + inv.total));
  }
  const dossiers = new Map<string, number>();
  for (const f of files) if (f.client_id) dossiers.set(f.client_id, (dossiers.get(f.client_id) ?? 0) + 1);

  return [...revenue.entries()]
    .map(([id, rev]) => ({ clientName: clientNames[id] ?? "—", revenue: rev, dossiers: dossiers.get(id) ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, top);
}

export function routeActivity(
  shipments: { origin: string | null; destination: string | null }[],
  top = 10,
): RouteActivity[] {
  const counts = new Map<string, number>();
  for (const s of shipments) {
    if (!s.origin && !s.destination) continue;
    const route = `${s.origin ?? "—"} → ${s.destination ?? "—"}`;
    counts.set(route, (counts.get(route) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

/** Count transports whose planned delivery is past and not yet delivered/closed. */
export function transportsOverdue(
  transport: { status: string; delivery_planned: string | null }[],
  now: Date,
): number {
  const done = new Set(["DELIVERED", "POD_RECEIVED", "CANCELLED"]);
  return transport.filter(
    (tr) => tr.delivery_planned && !done.has(tr.status) && new Date(tr.delivery_planned).getTime() < now.getTime(),
  ).length;
}

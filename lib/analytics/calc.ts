/**
 * Analytics aggregation — PURE, client + server safe (Phase 1.13).
 * ---------------------------------------------------------------------------
 * All executive-KPI math lives here so it is unit-testable without the DB. The
 * service fetches tenant-scoped rows and feeds them in; `now` is injected. Dates
 * are treated on the UTC calendar (Effitrans = Dakar, GMT+0).
 */
import type {
  Bar,
  CustomsKpis,
  FinancialKpis,
  InvoiceAgg,
  OperationsKpis,
  PortalKpis,
  TeamKpis,
  TransportKpis,
  TrendPoint,
} from "./types";

export type FileRow = { status: string; priority: string; created_at: string; client_id: string | null };
export type CustomsRow = { file_id: string; status: string; declaration_date: string | null; release_date: string | null };
export type TransportRow = { file_id: string; status: string; delivery_planned: string | null; delivery_actual: string | null };
export type TaskRow = { status: string };
export type ClientUserRow = { status: string; client_id: string };
export type ClosureRow = { created_at: string; occurred_at: string };

const ISSUED = new Set(["ISSUED", "PARTIALLY_PAID", "PAID"]);
const OPEN = new Set(["ISSUED", "PARTIALLY_PAID"]);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function startOfUtcDay(d: Date): number {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x.getTime();
}
function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}
function avg(values: number[]): number | null {
  return values.length ? round1(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

// ----------------------------------------------------------------- finance ----

export function computeFinancial(invoices: InvoiceAgg[], now: Date): FinancialKpis {
  const month = ym(now);
  const year = String(now.getUTCFullYear());
  const today = startOfUtcDay(now);
  let revenueThisMonth = 0, revenueYtd = 0, outstanding = 0, overdue = 0, invoicesIssuedThisMonth = 0;
  let billed = 0, paid = 0;

  for (const i of invoices) {
    if (!ISSUED.has(i.status)) continue;
    billed += i.total;
    paid += i.paid;
    if (OPEN.has(i.status)) {
      outstanding += i.balance;
      if (i.dueDate && i.balance > 0 && new Date(`${i.dueDate}T00:00:00Z`).getTime() < today) {
        overdue += i.balance;
      }
    }
    if (i.issueDate) {
      if (i.issueDate.slice(0, 7) === month) {
        revenueThisMonth += i.total;
        invoicesIssuedThisMonth += 1;
      }
      if (i.issueDate.slice(0, 4) === year) revenueYtd += i.total;
    }
  }

  return {
    revenueThisMonth: round2(revenueThisMonth),
    revenueYtd: round2(revenueYtd),
    outstanding: round2(outstanding),
    overdue: round2(overdue),
    invoicesIssuedThisMonth,
    collectionRate: billed > 0 ? round1((paid / billed) * 100) : 0,
  };
}

export function revenueTrend(invoices: InvoiceAgg[], now: Date, months = 6): TrendPoint[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    keys.push(ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  const byMonth = new Map(keys.map((k) => [k, 0]));
  for (const inv of invoices) {
    if (!ISSUED.has(inv.status) || !inv.issueDate) continue;
    const k = inv.issueDate.slice(0, 7);
    if (byMonth.has(k)) byMonth.set(k, round2(byMonth.get(k)! + inv.total));
  }
  return keys.map((month) => ({ month, value: byMonth.get(month) ?? 0 }));
}

export function revenueByClient(
  invoices: InvoiceAgg[],
  clientNames: Record<string, string>,
  top = 10,
): Bar[] {
  const totals = new Map<string, number>();
  for (const inv of invoices) {
    if (!ISSUED.has(inv.status) || !inv.clientId) continue;
    totals.set(inv.clientId, round2((totals.get(inv.clientId) ?? 0) + inv.total));
  }
  return [...totals.entries()]
    .map(([id, value]) => ({ label: clientNames[id] ?? "—", value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, top);
}

// -------------------------------------------------------------- operations ----

export function computeOperations(files: FileRow[], blockedCount: number, now: Date): OperationsKpis {
  const month = ym(now);
  let active = 0, newThisMonth = 0, delivered = 0, closed = 0, highPriority = 0;
  for (const f of files) {
    const isClosed = f.status === "CLOSED";
    if (!isClosed) active += 1;
    if (f.status === "DELIVERED") delivered += 1;
    if (isClosed) closed += 1;
    if (!isClosed && (f.priority === "high" || f.priority === "critical")) highPriority += 1;
    if (f.created_at.slice(0, 7) === month) newThisMonth += 1;
  }
  return { active, newThisMonth, delivered, closed, highPriority, blocked: blockedCount };
}

export function statusDistribution(files: FileRow[]): Bar[] {
  const order = ["DRAFT", "OPENED", "IN_PROGRESS", "DELIVERED", "CLOSED"];
  const counts = Object.fromEntries(order.map((s) => [s, 0])) as Record<string, number>;
  for (const f of files) if (f.status in counts) counts[f.status] += 1;
  return order.map((label) => ({ label, value: counts[label] }));
}

/** Files with a BLOCKED customs OR transport record (distinct). */
export function blockedOperations(customs: CustomsRow[], transport: TransportRow[]): number {
  const ids = new Set<string>();
  for (const c of customs) if (c.status === "BLOCKED") ids.add(c.file_id);
  for (const tr of transport) if (tr.status === "BLOCKED") ids.add(tr.file_id);
  return ids.size;
}

// ------------------------------------------------------------------ customs ----

export function computeCustoms(customs: CustomsRow[]): CustomsKpis {
  let pending = 0, underReview = 0, inspection = 0, released = 0;
  const releaseDays: number[] = [];
  for (const c of customs) {
    if (c.status === "DOCUMENTS_PENDING") pending += 1;
    if (c.status === "UNDER_REVIEW") underReview += 1;
    if (c.status === "INSPECTION") inspection += 1;
    if (c.status === "RELEASED") {
      released += 1;
      if (c.declaration_date && c.release_date) releaseDays.push(daysBetween(c.declaration_date, c.release_date));
    }
  }
  return { pending, underReview, inspection, released, avgReleaseDays: avg(releaseDays) };
}

export function customsPipeline(customs: CustomsRow[]): Bar[] {
  const b = { pending: 0, declared: 0, review: 0, inspection: 0, released: 0 };
  for (const c of customs) {
    if (["NOT_STARTED", "DOCUMENTS_PENDING", "DECLARATION_PREPARED"].includes(c.status)) b.pending += 1;
    else if (c.status === "DECLARED") b.declared += 1;
    else if (c.status === "UNDER_REVIEW") b.review += 1;
    else if (c.status === "INSPECTION") b.inspection += 1;
    else if (["DUTIES_ASSESSED", "RELEASED"].includes(c.status)) b.released += 1;
  }
  return [
    { label: "pending", value: b.pending },
    { label: "declared", value: b.declared },
    { label: "review", value: b.review },
    { label: "inspection", value: b.inspection },
    { label: "released", value: b.released },
  ];
}

// ---------------------------------------------------------------- transport ----

export function computeTransport(transport: TransportRow[]): TransportKpis {
  let planned = 0, inTransit = 0, delivered = 0, podReceived = 0;
  let onTimeTotal = 0, onTimeMet = 0;
  for (const tr of transport) {
    if (tr.status === "PLANNED") planned += 1;
    if (tr.status === "IN_TRANSIT") inTransit += 1;
    if (tr.status === "DELIVERED") delivered += 1;
    if (tr.status === "POD_RECEIVED") podReceived += 1;
    if (tr.delivery_planned && tr.delivery_actual) {
      onTimeTotal += 1;
      if (new Date(tr.delivery_actual).getTime() <= new Date(tr.delivery_planned).getTime()) onTimeMet += 1;
    }
  }
  return {
    planned,
    inTransit,
    delivered,
    podReceived,
    onTimePct: onTimeTotal ? round1((onTimeMet / onTimeTotal) * 100) : null,
  };
}

export function transportPipeline(transport: TransportRow[]): Bar[] {
  const keys: Record<string, string> = {
    PLANNED: "planned",
    DRIVER_ASSIGNED: "assigned",
    PICKED_UP: "pickedUp",
    IN_TRANSIT: "inTransit",
    DELIVERED: "delivered",
    POD_RECEIVED: "podReceived",
  };
  const order = ["planned", "assigned", "pickedUp", "inTransit", "delivered", "podReceived"];
  const counts = Object.fromEntries(order.map((k) => [k, 0])) as Record<string, number>;
  for (const tr of transport) {
    const k = keys[tr.status];
    if (k) counts[k] += 1;
  }
  return order.map((label) => ({ label, value: counts[label] }));
}

// ------------------------------------------------------------------- portal ----

export function computePortal(
  clientUsers: ClientUserRow[],
  sharedDocuments: number,
  downloads: number,
  invoiceViews: number,
): PortalKpis {
  const activeClients = new Set(clientUsers.filter((u) => u.status === "ACTIVE").map((u) => u.client_id));
  return { users: clientUsers.length, activeClients: activeClients.size, sharedDocuments, downloads, invoiceViews };
}

// --------------------------------------------------------------------- team ----

export function computeTeam(
  tasks: TaskRow[],
  customs: CustomsRow[],
  invoices: InvoiceAgg[],
  closures: ClosureRow[],
): TeamKpis {
  const openTasks = tasks.filter((t) => ["TODO", "IN_PROGRESS", "BLOCKED"].includes(t.status)).length;
  const completedTasks = tasks.filter((t) => t.status === "DONE").length;
  const customsReleases = customs.filter((c) => c.status === "RELEASED").length;
  const invoicesIssued = invoices.filter((i) => ISSUED.has(i.status)).length;
  const avgClosureDays = avg(closures.map((c) => daysBetween(c.created_at, c.occurred_at)));
  return { openTasks, completedTasks, customsReleases, invoicesIssued, avgClosureDays };
}

/**
 * Business-intelligence aggregation (Phase 3.0) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Derived-only analytics over the existing operational records. No new tables,
 * no ETL, no copies. Fully unit-tested with deterministic fixtures (`now`
 * injected). Money is plain numbers (XOF default). Where a metric lacks reliable
 * source timestamps it returns null → the UI shows "Not enough data available".
 */
import { isActiveFileStatus, isFileStatus } from "@/lib/files/status";

const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
function isIssued(status: string): boolean {
  return status !== "DRAFT" && status !== "VOID";
}

// --------------------------------------------------------------- inputs ----

export type BiInvoice = {
  id: string;
  clientId: string | null;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
};
export type BiPayment = { clientId: string | null; issueDate: string | null; paidAt: string; amount: number; reversed: boolean };
export type BiClient = { id: string; name: string | null };
export type BiFile = { clientId: string | null; status: string; createdAt: string };

// ----------------------------------------------------- Area 1 — revenue ----

export type RevenueMetrics = {
  thisMonth: number;
  lastMonth: number;
  ytd: number;
  outstanding: number;
  collectedThisMonth: number;
  avgInvoiceValue: number;
};

export function revenueMetrics(invoices: BiInvoice[], payments: BiPayment[], now: Date): RevenueMetrics {
  const thisKey = monthKey(now);
  const lastKey = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const year = now.getUTCFullYear();
  const issued = invoices.filter((i) => isIssued(i.status) && i.issueDate);

  const inMonth = (iso: string | null, key: string) => iso != null && monthKey(new Date(iso)) === key;
  const thisMonth = issued.filter((i) => inMonth(i.issueDate, thisKey)).reduce((s, i) => s + i.total, 0);
  const lastMonth = issued.filter((i) => inMonth(i.issueDate, lastKey)).reduce((s, i) => s + i.total, 0);
  const ytd = issued.filter((i) => i.issueDate && new Date(i.issueDate).getUTCFullYear() === year).reduce((s, i) => s + i.total, 0);
  const outstanding = invoices.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID").reduce((s, i) => s + i.balance, 0);
  const collectedThisMonth = payments
    .filter((p) => !p.reversed && inMonth(p.paidAt, thisKey))
    .reduce((s, p) => s + p.amount, 0);
  const avgInvoiceValue = issued.length ? round1(issued.reduce((s, i) => s + i.total, 0) / issued.length) : 0;

  return { thisMonth, lastMonth, ytd, outstanding, collectedThisMonth, avgInvoiceValue };
}

// ----------------------------------------------- Area 2 — client intel ----

export type ClientRow = {
  clientId: string;
  clientName: string | null;
  revenue: number;
  shipments: number;
  outstanding: number;
  avgPaymentDelayDays: number | null;
  lastActivity: string | null;
};

export function clientIntelligence(
  clients: BiClient[],
  invoices: BiInvoice[],
  files: BiFile[],
  payments: BiPayment[],
): ClientRow[] {
  const rows = clients.map((c) => {
    const cInv = invoices.filter((i) => i.clientId === c.id && isIssued(i.status));
    const cFiles = files.filter((f) => f.clientId === c.id);
    const cPays = payments.filter((p) => p.clientId === c.id && !p.reversed && p.issueDate);
    const delays = cPays
      .map((p) => (new Date(p.paidAt).getTime() - new Date(p.issueDate as string).getTime()) / DAY)
      .filter((d) => d >= 0);
    const dates = [
      ...cFiles.map((f) => f.createdAt),
      ...cInv.map((i) => i.issueDate),
      ...cPays.map((p) => p.paidAt),
    ].filter((x): x is string => Boolean(x));
    return {
      clientId: c.id,
      clientName: c.name,
      revenue: cInv.reduce((s, i) => s + i.total, 0),
      shipments: cFiles.length,
      outstanding: invoices.filter((i) => i.clientId === c.id && (i.status === "ISSUED" || i.status === "PARTIALLY_PAID")).reduce((s, i) => s + i.balance, 0),
      avgPaymentDelayDays: delays.length ? round1(delays.reduce((s, d) => s + d, 0) / delays.length) : null,
      lastActivity: dates.length ? dates.sort().pop()! : null,
    };
  });
  return rows.sort((a, b) => b.revenue - a.revenue);
}

export function activeClientCount(clients: BiClient[], files: BiFile[]): number {
  // DEC-B43 — "has an active dossier" uses THE canonical active predicate.
  const withOpen = new Set(
    files
      .filter((f) => f.clientId && (!isFileStatus(f.status) || isActiveFileStatus(f.status)))
      .map((f) => f.clientId as string),
  );
  return clients.filter((c) => withOpen.has(c.id)).length;
}

// --------------------------------------------- Area 6 — receivables aging ----

export type AgingBuckets = { b0_30: number; b31_60: number; b61_90: number; b90p: number; total: number; count: number };

export function receivablesAging(invoices: BiInvoice[], now: Date): AgingBuckets {
  const out: AgingBuckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0, total: 0, count: 0 };
  for (const i of invoices) {
    if (i.status !== "ISSUED" && i.status !== "PARTIALLY_PAID") continue;
    if (i.balance <= 0 || !i.dueDate) continue;
    const overdueDays = (now.getTime() - new Date(i.dueDate).getTime()) / DAY;
    if (overdueDays <= 0) continue; // not overdue yet
    out.count += 1;
    out.total += i.balance;
    if (overdueDays <= 30) out.b0_30 += i.balance;
    else if (overdueDays <= 60) out.b31_60 += i.balance;
    else if (overdueDays <= 90) out.b61_90 += i.balance;
    else out.b90p += i.balance;
  }
  return out;
}

// ------------------------------------------- Area 5 — dept productivity ----

export type DepartmentProductivity = {
  documentation: { processed: number; verified: number };
  customs: { declarations: number; releases: number; avgClearanceDays: number | null };
  transport: { delivered: number; podReceived: number; podRate: number | null; avgDeliveryDays: number | null };
  finance: { invoicesIssued: number; paymentsRecorded: number; collectionRate: number | null };
};

export function departmentProductivity(input: {
  documents: { status: string }[];
  customs: { status: string; declaration_date: string | null; release_date: string | null }[];
  transport: { status: string; pickup_actual: string | null; delivery_actual: string | null }[];
  invoices: BiInvoice[];
  payments: BiPayment[];
}): DepartmentProductivity {
  const docs = input.documents;
  const cust = input.customs;
  const tr = input.transport;

  const clearance = cust
    .filter((c) => c.declaration_date && c.release_date)
    .map((c) => (new Date(c.release_date as string).getTime() - new Date(c.declaration_date as string).getTime()) / DAY)
    .filter((d) => d >= 0);
  const delivered = tr.filter((t) => t.status === "DELIVERED" || t.status === "POD_RECEIVED").length;
  const pod = tr.filter((t) => t.status === "POD_RECEIVED").length;
  const deliveryDurations = tr
    .filter((t) => t.pickup_actual && t.delivery_actual)
    .map((t) => (new Date(t.delivery_actual as string).getTime() - new Date(t.pickup_actual as string).getTime()) / DAY)
    .filter((d) => d >= 0);

  const issued = input.invoices.filter((i) => isIssued(i.status));
  const issuedTotal = issued.reduce((s, i) => s + i.total, 0);
  const collected = input.payments.filter((p) => !p.reversed).reduce((s, p) => s + p.amount, 0);

  return {
    documentation: {
      processed: docs.length,
      verified: docs.filter((d) => d.status === "APPROVED").length,
    },
    customs: {
      declarations: cust.filter((c) => c.declaration_date).length,
      releases: cust.filter((c) => c.status === "RELEASED").length,
      avgClearanceDays: clearance.length ? round1(clearance.reduce((s, d) => s + d, 0) / clearance.length) : null,
    },
    transport: {
      delivered,
      podReceived: pod,
      podRate: delivered ? Math.round((pod / delivered) * 100) : null,
      avgDeliveryDays: deliveryDurations.length ? round1(deliveryDurations.reduce((s, d) => s + d, 0) / deliveryDurations.length) : null,
    },
    finance: {
      invoicesIssued: issued.length,
      paymentsRecorded: input.payments.filter((p) => !p.reversed).length,
      collectionRate: issuedTotal > 0 ? Math.round((collected / issuedTotal) * 100) : null,
    },
  };
}

// ------------------------------------------------------- Area 9 — CSV ----

/** RFC-4180 CSV with a UTF-8 BOM (Excel-friendly). PURE. */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))];
  return "﻿" + lines.join("\r\n");
}

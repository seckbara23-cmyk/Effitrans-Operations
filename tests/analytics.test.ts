import { describe, it, expect } from "vitest";
import {
  computeFinancial,
  revenueTrend,
  revenueByClient,
  computeOperations,
  statusDistribution,
  blockedOperations,
  computeCustoms,
  customsPipeline,
  computeTransport,
  transportPipeline,
  computePortal,
  computeTeam,
} from "@/lib/analytics/calc";
import type { InvoiceAgg } from "@/lib/analytics/types";

const NOW = new Date("2026-06-15T12:00:00Z");

const inv = (o: Partial<InvoiceAgg>): InvoiceAgg => ({
  status: "ISSUED",
  issueDate: "2026-06-01",
  dueDate: "2026-06-30",
  clientId: "c1",
  total: 1000,
  paid: 0,
  balance: 1000,
  ...o,
});

describe("financial KPIs", () => {
  const invoices = [
    inv({ status: "ISSUED", issueDate: "2026-06-05", total: 1000, paid: 0, balance: 1000, dueDate: "2026-06-10" }), // overdue (past due, unpaid)
    inv({ status: "PAID", issueDate: "2026-06-20", total: 2000, paid: 2000, balance: 0 }),
    inv({ status: "PARTIALLY_PAID", issueDate: "2026-03-01", total: 500, paid: 200, balance: 300, dueDate: "2026-12-01" }),
    inv({ status: "DRAFT", issueDate: "2026-06-01", total: 9999, paid: 0, balance: 9999 }), // excluded
    inv({ status: "VOID", issueDate: "2026-06-01", total: 9999 }), // excluded
  ];

  it("computes revenue, receivables, collection rate", () => {
    const f = computeFinancial(invoices, NOW);
    expect(f.revenueThisMonth).toBe(3000); // 1000 + 2000 (June issued, not draft/void)
    expect(f.revenueYtd).toBe(3500); // + 500 (March)
    expect(f.outstanding).toBe(1300); // 1000 (issued) + 300 (partial); paid excluded
    expect(f.overdue).toBe(1000); // only the past-due unpaid issued
    expect(f.invoicesIssuedThisMonth).toBe(2);
    // collection: paid 2200 / billed 3500
    expect(f.collectionRate).toBe(62.9);
  });

  it("revenue trend buckets by month and ignores drafts", () => {
    const trend = revenueTrend(invoices, NOW, 6);
    expect(trend).toHaveLength(6);
    expect(trend[trend.length - 1]).toEqual({ month: "2026-06", value: 3000 });
    expect(trend.find((p) => p.month === "2026-03")?.value).toBe(500);
  });

  it("revenue by client, top N, named", () => {
    const bars = revenueByClient(
      [inv({ clientId: "a", total: 100 }), inv({ clientId: "b", total: 300 }), inv({ clientId: "a", total: 50 })],
      { a: "Alpha", b: "Beta" },
    );
    expect(bars[0]).toEqual({ label: "Beta", value: 300 });
    expect(bars[1]).toEqual({ label: "Alpha", value: 150 });
  });
});

describe("operations + customs + transport KPIs", () => {
  const files = [
    { status: "OPENED", priority: "high", created_at: "2026-06-02", client_id: "c1" },
    { status: "CLOSED", priority: "low", created_at: "2026-01-02", client_id: "c1" },
    { status: "DELIVERED", priority: "critical", created_at: "2026-06-09", client_id: "c2" },
    // DEC-B43 — CANCELLED is terminal: not active, not high-priority work.
    { status: "CANCELLED", priority: "critical", created_at: "2026-06-10", client_id: "c2" },
  ];
  it("operations counts + status distribution (DEC-B43: CANCELLED excluded from active)", () => {
    const ops = computeOperations(files, 1, NOW);
    expect(ops).toEqual({ active: 2, newThisMonth: 3, delivered: 1, closed: 1, highPriority: 2, blocked: 1 });
    expect(statusDistribution(files)).toEqual([
      { label: "DRAFT", value: 0 },
      { label: "OPENED", value: 1 },
      { label: "IN_PROGRESS", value: 0 },
      { label: "DELIVERED", value: 1 },
      { label: "CLOSED", value: 1 },
    ]);
  });
  it("blocked operations counts distinct files", () => {
    const c = [{ file_id: "f1", status: "BLOCKED", declaration_date: null, release_date: null }];
    const tr = [{ file_id: "f1", status: "BLOCKED", delivery_planned: null, delivery_actual: null }, { file_id: "f2", status: "BLOCKED", delivery_planned: null, delivery_actual: null }];
    expect(blockedOperations(c, tr)).toBe(2);
  });
  it("customs avg release time + pipeline", () => {
    const c = [
      { file_id: "f1", status: "RELEASED", declaration_date: "2026-06-01", release_date: "2026-06-06" },
      { file_id: "f2", status: "DOCUMENTS_PENDING", declaration_date: null, release_date: null },
    ];
    expect(computeCustoms(c)).toEqual({ pending: 1, underReview: 0, inspection: 0, released: 1, avgReleaseDays: 5 });
    expect(customsPipeline(c).find((b) => b.label === "released")?.value).toBe(1);
  });
  it("transport on-time % + pipeline", () => {
    const tr = [
      { file_id: "f1", status: "DELIVERED", delivery_planned: "2026-06-10T00:00:00Z", delivery_actual: "2026-06-09T00:00:00Z" }, // on time
      { file_id: "f2", status: "POD_RECEIVED", delivery_planned: "2026-06-10T00:00:00Z", delivery_actual: "2026-06-12T00:00:00Z" }, // late
    ];
    const tk = computeTransport(tr);
    expect(tk.delivered).toBe(1);
    expect(tk.podReceived).toBe(1);
    expect(tk.onTimePct).toBe(50);
    expect(transportPipeline(tr).find((b) => b.label === "delivered")?.value).toBe(1);
  });
});

describe("portal + team KPIs", () => {
  it("portal active clients distinct", () => {
    const cu = [
      { status: "ACTIVE", client_id: "a" },
      { status: "ACTIVE", client_id: "a" },
      { status: "DISABLED", client_id: "b" },
    ];
    expect(computePortal(cu, 4, 9, 3)).toEqual({ users: 3, activeClients: 1, sharedDocuments: 4, downloads: 9, invoiceViews: 3 });
  });
  it("team productivity + avg closure days", () => {
    const tasks = [{ status: "TODO" }, { status: "DONE" }, { status: "DONE" }, { status: "CANCELLED" }];
    const customs = [{ file_id: "f1", status: "RELEASED", declaration_date: null, release_date: null }];
    const invoices = [inv({ status: "ISSUED" }), inv({ status: "DRAFT" })];
    const closures = [{ created_at: "2026-06-01", occurred_at: "2026-06-11" }];
    expect(computeTeam(tasks, customs, invoices, closures)).toEqual({
      openTasks: 1,
      completedTasks: 2,
      customsReleases: 1,
      invoicesIssued: 1,
      avgClosureDays: 10,
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  computeHealth,
  buildAlerts,
  computeScorecard,
  collectionsTrend,
  newDossiersPerMonth,
  topClients,
  routeActivity,
  transportsOverdue,
} from "@/lib/analytics/executive";
import type { AnalyticsData, InvoiceAgg } from "@/lib/analytics/types";

const NOW = new Date("2026-06-15T12:00:00Z");

describe("executive health + alerts", () => {
  it("health thresholds", () => {
    expect(computeHealth(0, 0)).toBe("GREEN");
    expect(computeHealth(2, 0)).toBe("AMBER");
    expect(computeHealth(0, 1)).toBe("AMBER");
    expect(computeHealth(5, 0)).toBe("RED"); // significant overdue
    expect(computeHealth(1, 2)).toBe("RED"); // multiple blocked
  });
  it("alerts derive from counts; all-clear when none", () => {
    const a = buildAlerts({ overdueCount: 6, blockedCustoms: 1, blockedTransport: 0, transportsOverdue: 3 });
    expect(a.find((x) => x.key === "overdueInvoices")).toEqual({ level: "RED", key: "overdueInvoices", count: 6 });
    expect(a.find((x) => x.key === "blockedCustoms")?.level).toBe("AMBER");
    expect(a.find((x) => x.key === "transportsOverdue")?.count).toBe(3);
    expect(buildAlerts({ overdueCount: 0, blockedCustoms: 0, blockedTransport: 0, transportsOverdue: 0 })).toEqual([
      { level: "GREEN", key: "allClear", count: 0 },
    ]);
  });
});

describe("executive scorecard", () => {
  const base: AnalyticsData = {
    currency: "XOF",
    financial: { revenueThisMonth: 0, revenueYtd: 0, outstanding: 1000, overdue: 0, invoicesIssuedThisMonth: 0, collectionRate: 80 },
    operations: { active: 4, newThisMonth: 0, delivered: 3, closed: 1, highPriority: 0, blocked: 0 },
    customs: { pending: 0, underReview: 0, inspection: 0, released: 8, avgReleaseDays: 5 },
    transport: { planned: 0, inTransit: 0, delivered: 0, podReceived: 8, onTimePct: 90 },
    portal: { users: 0, activeClients: 0, sharedDocuments: 0, downloads: 0, invoiceViews: 0 },
    team: { openTasks: 0, completedTasks: 0, customsReleases: 0, invoicesIssued: 0, avgClosureDays: null },
    charts: {
      revenueTrend: null,
      statusDistribution: [
        { label: "DRAFT", value: 0 },
        { label: "OPENED", value: 1 },
        { label: "IN_PROGRESS", value: 0 },
        { label: "DELIVERED", value: 3 },
        { label: "CLOSED", value: 1 },
      ],
      revenueByClient: null,
      customsPipeline: [{ label: "released", value: 10 }],
      transportPipeline: [{ label: "podReceived", value: 10 }],
    },
  };

  it("derives 0-100 scores + overall from existing KPIs", () => {
    const s = computeScorecard(base);
    // operations: (delivered+closed)/total = 4/5 = 80, no blocked
    expect(s.operations).toBe(80);
    // customs: released/totalCustoms = 8/10 = 80
    expect(s.customs).toBe(80);
    // transport: (pod 8/10*100=80 + onTime 90)/2 = 85
    expect(s.transport).toBe(85);
    // collections: rate 80, no overdue -> 80
    expect(s.collections).toBe(80);
    expect(s.overall).toBe(81); // round((80+80+85+80)/4)
  });

  it("collections is null (and excluded from overall) without finance", () => {
    const s = computeScorecard({ ...base, financial: null });
    expect(s.collections).toBeNull();
    expect(s.overall).toBe(82); // round((80+80+85)/3)
  });
});

describe("executive trends + tables", () => {
  const inv = (o: Partial<InvoiceAgg>): InvoiceAgg => ({
    status: "ISSUED", issueDate: "2026-06-01", dueDate: null, clientId: "c1", total: 1000, paid: 0, balance: 1000, ...o,
  });

  it("collections trend buckets issued vs payments by month", () => {
    const invoices = [inv({ issueDate: "2026-06-02", total: 1000 }), inv({ issueDate: "2026-05-02", total: 500 })];
    const payments = [
      { amount: 300, paidAt: "2026-06-10", reversed: false },
      { amount: 999, paidAt: "2026-06-10", reversed: true }, // reversed -> excluded
    ];
    const trend = collectionsTrend(invoices, payments, NOW, 12);
    expect(trend).toHaveLength(12);
    expect(trend[trend.length - 1]).toEqual({ month: "2026-06", issued: 1000, paid: 300 });
  });

  it("new dossiers per month", () => {
    const files = [{ created_at: "2026-06-03" }, { created_at: "2026-06-20" }, { created_at: "2026-04-01" }];
    const trend = newDossiersPerMonth(files, NOW, 12);
    expect(trend[trend.length - 1]).toEqual({ month: "2026-06", value: 2 });
    expect(trend.find((p) => p.month === "2026-04")?.value).toBe(1);
  });

  it("top clients by revenue with dossier counts", () => {
    const invoices = [inv({ clientId: "a", total: 300 }), inv({ clientId: "b", total: 100 }), inv({ status: "DRAFT", clientId: "a", total: 999 })];
    const files = [{ client_id: "a" }, { client_id: "a" }, { client_id: "b" }];
    const top = topClients(invoices, files, { a: "Alpha", b: "Beta" });
    expect(top[0]).toEqual({ clientName: "Alpha", revenue: 300, dossiers: 2 });
    expect(top[1]).toEqual({ clientName: "Beta", revenue: 100, dossiers: 1 });
  });

  it("route activity ranks origin->destination", () => {
    const ships = [
      { origin: "Dakar", destination: "Mali" },
      { origin: "Dakar", destination: "Mali" },
      { origin: "Dakar", destination: "Guinée" },
      { origin: null, destination: null }, // skipped
    ];
    const routes = routeActivity(ships);
    expect(routes[0]).toEqual({ route: "Dakar → Mali", count: 2 });
    expect(routes).toHaveLength(2);
  });

  it("transports overdue = past planned & not done", () => {
    const tr = [
      { status: "IN_TRANSIT", delivery_planned: "2026-06-01T00:00:00Z" }, // overdue
      { status: "DELIVERED", delivery_planned: "2026-06-01T00:00:00Z" }, // done
      { status: "PLANNED", delivery_planned: "2026-12-01T00:00:00Z" }, // future
    ];
    expect(transportsOverdue(tr, NOW)).toBe(1);
  });
});

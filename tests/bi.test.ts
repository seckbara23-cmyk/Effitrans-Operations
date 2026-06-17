import { describe, it, expect } from "vitest";
import {
  revenueMetrics,
  clientIntelligence,
  activeClientCount,
  receivablesAging,
  departmentProductivity,
  toCsv,
  type BiInvoice,
  type BiPayment,
} from "@/lib/bi/aggregate";
import { toXlsx } from "@/lib/bi/xlsx";
import { revenueReport, clientsReport, slaReport } from "@/lib/bi/reports";
import type { BusinessIntelligence } from "@/lib/bi/service";

const NOW = new Date("2026-06-17T12:00:00.000Z");
const day = (iso: string) => iso;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

describe("revenueMetrics", () => {
  const invoices: BiInvoice[] = [
    { id: "a", clientId: "c1", status: "ISSUED", issueDate: "2026-06-05", dueDate: "2026-07-05", total: 1000, balance: 1000 },
    { id: "b", clientId: "c1", status: "PAID", issueDate: "2026-05-10", dueDate: "2026-06-10", total: 2000, balance: 0 },
    { id: "c", clientId: "c2", status: "DRAFT", issueDate: null, dueDate: null, total: 500, balance: 500 },
    { id: "d", clientId: "c2", status: "ISSUED", issueDate: "2026-02-01", dueDate: "2026-03-01", total: 3000, balance: 3000 },
  ];
  const payments: BiPayment[] = [
    { clientId: "c1", issueDate: "2026-05-10", paidAt: "2026-06-12", amount: 2000, reversed: false },
    { clientId: "c1", issueDate: "2026-05-10", paidAt: "2026-06-12", amount: 99, reversed: true }, // reversed -> ignored
  ];
  it("computes month/ytd/outstanding/collected/avg (issued = non-draft/void)", () => {
    const r = revenueMetrics(invoices, payments, NOW);
    expect(r.thisMonth).toBe(1000); // June issued: a
    expect(r.lastMonth).toBe(2000); // May issued: b
    expect(r.ytd).toBe(6000); // a+b+d (all 2026 issued, draft excluded)
    expect(r.outstanding).toBe(4000); // a(1000) + d(3000)
    expect(r.collectedThisMonth).toBe(2000); // one non-reversed June payment
    expect(r.avgInvoiceValue).toBe(2000); // (1000+2000+3000)/3
  });
});

describe("clientIntelligence + activeClientCount", () => {
  const clients = [{ id: "c1", name: "Alpha" }, { id: "c2", name: "Beta" }];
  const invoices: BiInvoice[] = [
    { id: "a", clientId: "c1", status: "ISSUED", issueDate: "2026-06-01", dueDate: "2026-07-01", total: 5000, balance: 2000 },
    { id: "b", clientId: "c2", status: "ISSUED", issueDate: "2026-06-01", dueDate: "2026-07-01", total: 1000, balance: 0 },
  ];
  const files = [
    { clientId: "c1", status: "IN_PROGRESS", createdAt: daysAgo(2) },
    { clientId: "c1", status: "CLOSED", createdAt: daysAgo(40) },
    { clientId: "c2", status: "CLOSED", createdAt: daysAgo(50) },
  ];
  const payments: BiPayment[] = [{ clientId: "c1", issueDate: "2026-06-01", paidAt: "2026-06-06", amount: 3000, reversed: false }];

  it("ranks clients by revenue with outstanding / shipments / payment delay", () => {
    const rows = clientIntelligence(clients, invoices, files, payments);
    expect(rows[0].clientId).toBe("c1"); // higher revenue first
    expect(rows[0].revenue).toBe(5000);
    expect(rows[0].shipments).toBe(2);
    expect(rows[0].outstanding).toBe(2000);
    expect(rows[0].avgPaymentDelayDays).toBe(5); // 2026-06-06 - 2026-06-01
    expect(rows[1].avgPaymentDelayDays).toBeNull(); // c2 no payments
  });
  it("counts active clients (those with a non-closed dossier)", () => {
    expect(activeClientCount(clients, files)).toBe(1); // only c1 has an open file
  });
});

describe("receivablesAging", () => {
  const invoices: BiInvoice[] = [
    { id: "a", clientId: "c1", status: "ISSUED", issueDate: "x", dueDate: daysAgo(10), total: 100, balance: 100 }, // 0-30
    { id: "b", clientId: "c1", status: "PARTIALLY_PAID", issueDate: "x", dueDate: daysAgo(45), total: 200, balance: 50 }, // 31-60
    { id: "c", clientId: "c1", status: "ISSUED", issueDate: "x", dueDate: daysAgo(75), total: 300, balance: 300 }, // 61-90
    { id: "d", clientId: "c1", status: "ISSUED", issueDate: "x", dueDate: daysAgo(120), total: 400, balance: 400 }, // 90+
    { id: "e", clientId: "c1", status: "ISSUED", issueDate: "x", dueDate: daysAgo(-5), total: 500, balance: 500 }, // not overdue
    { id: "f", clientId: "c1", status: "PAID", issueDate: "x", dueDate: daysAgo(60), total: 600, balance: 0 }, // paid
  ];
  it("buckets overdue balances by age", () => {
    expect(receivablesAging(invoices, NOW)).toEqual({ b0_30: 100, b31_60: 50, b61_90: 300, b90p: 400, total: 850, count: 4 });
  });
});

describe("departmentProductivity", () => {
  it("aggregates per-department counts + durations", () => {
    const p = departmentProductivity({
      documents: [{ status: "APPROVED" }, { status: "APPROVED" }, { status: "UPLOADED" }],
      customs: [
        { status: "RELEASED", declaration_date: "2026-06-01", release_date: "2026-06-04" },
        { status: "DECLARED", declaration_date: "2026-06-10", release_date: null },
      ],
      transport: [
        { status: "POD_RECEIVED", pickup_actual: "2026-06-01", delivery_actual: "2026-06-03" },
        { status: "DELIVERED", pickup_actual: null, delivery_actual: null },
      ],
      invoices: [
        { id: "a", clientId: "c1", status: "ISSUED", issueDate: "x", dueDate: null, total: 1000, balance: 400 },
      ],
      payments: [{ clientId: "c1", issueDate: "x", paidAt: "y", amount: 600, reversed: false }],
    });
    expect(p.documentation).toEqual({ processed: 3, verified: 2 });
    expect(p.customs).toEqual({ declarations: 2, releases: 1, avgClearanceDays: 3 });
    expect(p.transport.delivered).toBe(2);
    expect(p.transport.podReceived).toBe(1);
    expect(p.transport.podRate).toBe(50);
    expect(p.transport.avgDeliveryDays).toBe(2);
    expect(p.finance).toEqual({ invoicesIssued: 1, paymentsRecorded: 1, collectionRate: 60 });
  });
});

describe("CSV export", () => {
  it("escapes and joins with a BOM", () => {
    const csv = toCsv(["Client", "Revenue"], [["Al, pha", 5000], ['Be"ta', 0]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Al, pha",5000');
    expect(csv).toContain('"Be""ta",0');
  });
});

describe("report table builders", () => {
  const bi = {
    canFinance: true,
    currency: "XOF",
    revenue: { thisMonth: 1000, lastMonth: 800, ytd: 9000, outstanding: 4000, collectedThisMonth: 2000, avgInvoiceValue: 1500 },
    activeClients: 3,
    clients: [{ clientId: "c1", clientName: "Alpha", revenue: 5000, shipments: 4, outstanding: 2000, avgPaymentDelayDays: 6, lastActivity: "2026-06-10T00:00:00Z" }],
    topOverdueClients: [{ clientName: "Alpha", outstanding: 2000 }],
    aging: { b0_30: 100, b31_60: 0, b61_90: 0, b90p: 400, total: 500, count: 2 },
    productivity: {
      documentation: { processed: 3, verified: 2 },
      customs: { declarations: 2, releases: 1, avgClearanceDays: 3 },
      transport: { delivered: 2, podReceived: 1, podRate: 50, avgDeliveryDays: 2 },
      finance: { invoicesIssued: 1, paymentsRecorded: 1, collectionRate: 60 },
    },
  } as unknown as BusinessIntelligence;

  it("revenue report exposes the six metrics", () => {
    const r = revenueReport(bi);
    expect(r.headers).toEqual(["Métrique", "Montant"]);
    expect(r.rows).toHaveLength(6);
    expect(r.rows[0]).toEqual(["Revenu (mois en cours)", 1000]);
  });

  it("clients report rows mirror the ranked clients", () => {
    const r = clientsReport(bi);
    expect(r.rows[0]).toEqual(["Alpha", 5000, 4, 2000, 6, "2026-06-10"]);
  });

  it("SLA report computes compliance % per department", () => {
    const r = slaReport({
      documentation: { normal: 8, warning: 2, critical: 0 },
      customs: { normal: 0, warning: 0, critical: 0 },
      transport: { normal: 5, warning: 0, critical: 5 },
      finance: { normal: 3, warning: 1, critical: 0 },
    });
    expect(r.rows[0]).toEqual(["Documentation", 8, 2, 0, 80]); // 8/10
    expect(r.rows[1]).toEqual(["Douane", 0, 0, 0, "N/A"]); // no tracked dossiers
    expect(r.rows[2]).toEqual(["Transport", 5, 0, 5, 50]); // 5/10
  });
});

describe("XLSX export", () => {
  it("produces a valid stored-zip xlsx (PK magic + worksheet part + cell values)", () => {
    const buf = toXlsx(["Client", "Revenue"], [["Alpha", 5000]]);
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
    expect(buf.length).toBeGreaterThan(200);
    // STORED zip -> XML parts appear verbatim in the buffer.
    const text = new TextDecoder().decode(buf);
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("Alpha");
    expect(text).toContain("<v>5000</v>");
  });
});

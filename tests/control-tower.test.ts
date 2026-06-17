import { describe, it, expect } from "vitest";
import { getDossierLifecycle, type LifecycleInput } from "@/lib/files/lifecycle";
import {
  funnelStage,
  funnelCounts,
  flowCounts,
  agingBuckets,
  bottlenecks,
  needsAttention,
  ageDays,
  transportTimeKpis,
  type DossierLifecycleRow,
} from "@/lib/control-tower/aggregate";

const NOW = new Date("2026-06-17T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function mkRow(o: Partial<LifecycleInput> & {
  fileId?: string;
  createdAt?: string;
  priority?: string;
  overdueInvoice?: boolean;
}): DossierLifecycleRow {
  const input: LifecycleInput = {
    fileId: o.fileId ?? "f1",
    file: o.file ?? { status: "DRAFT", type: "IMP" },
    documents: o.documents ?? [],
    missingRequired: o.missingRequired ?? [],
    customs: o.customs ?? null,
    transport: o.transport ?? null,
    invoices: o.invoices ?? [],
    podApproved: o.podApproved ?? false,
  };
  return {
    fileId: input.fileId,
    fileNumber: o.fileId ?? "f1",
    clientName: "Client",
    priority: o.priority ?? "normal",
    fileStatus: input.file.status,
    createdAt: o.createdAt ?? daysAgo(1),
    overdueInvoice: o.overdueInvoice ?? false,
    lifecycle: getDossierLifecycle(input),
  };
}

describe("control-tower funnelStage", () => {
  const stage = (i: Partial<LifecycleInput>) => {
    const r = mkRow(i);
    return funnelStage(r.lifecycle.currentStep, r.fileStatus);
  };
  it("maps each lifecycle position to a funnel stage", () => {
    expect(stage({ file: { status: "DRAFT", type: "IMP" } })).toBe("draft");
    expect(stage({ file: { status: "OPENED", type: "IMP" }, missingRequired: [{ label: "BL" }] })).toBe("documents");
    expect(stage({ file: { status: "IN_PROGRESS", type: "IMP" }, documents: [{ status: "APPROVED" }], customs: { status: "DECLARED" } })).toBe("customs");
    expect(stage({ file: { status: "IN_PROGRESS", type: "IMP" }, documents: [{ status: "APPROVED" }], customs: { status: "RELEASED" }, transport: { status: "NOT_STARTED" } })).toBe("transport");
    expect(stage({ file: { status: "DELIVERED", type: "IMP" }, documents: [{ status: "APPROVED" }], customs: { status: "RELEASED" }, transport: { status: "DELIVERED" } })).toBe("delivered");
    expect(stage({ file: { status: "DELIVERED", type: "IMP" }, documents: [{ status: "APPROVED" }], customs: { status: "RELEASED" }, transport: { status: "POD_RECEIVED" }, podApproved: true, invoices: [{ status: "ISSUED", balance: 100 }] })).toBe("invoiced");
    expect(stage({ file: { status: "CLOSED", type: "IMP" } })).toBe("archived");
  });
});

describe("control-tower aggregations", () => {
  const rows = [
    mkRow({ fileId: "a", file: { status: "OPENED", type: "IMP" }, missingRequired: [{ label: "Facture" }], priority: "high", createdAt: daysAgo(7) }), // docs blocked
    mkRow({ fileId: "b", file: { status: "IN_PROGRESS", type: "IMP" }, documents: [{ status: "APPROVED" }], customs: { status: "INSPECTION" }, createdAt: daysAgo(1) }), // customs inspection
    mkRow({ fileId: "c", file: { status: "DELIVERED", type: "IMP" }, documents: [{ status: "APPROVED" }], customs: { status: "RELEASED" }, transport: { status: "DELIVERED" }, createdAt: daysAgo(4) }), // awaiting POD
    mkRow({ fileId: "d", file: { status: "CLOSED", type: "IMP" }, documents: [{ status: "APPROVED" }], customs: { status: "RELEASED" }, transport: { status: "POD_RECEIVED" }, podApproved: true, invoices: [{ status: "PAID", balance: 0 }], createdAt: daysAgo(12) }), // archived
    mkRow({ fileId: "e", file: { status: "IN_PROGRESS", type: "IMP" }, documents: [{ status: "APPROVED" }], customs: { status: "RELEASED" }, transport: { status: "POD_RECEIVED" }, podApproved: true, invoices: [{ status: "ISSUED", balance: 500 }], overdueInvoice: true, createdAt: daysAgo(20) }), // overdue invoice
  ];

  it("funnel counts cover all dossiers", () => {
    const f = funnelCounts(rows);
    const total = Object.values(f).reduce((s, n) => s + n, 0);
    expect(total).toBe(rows.length);
    expect(f.documents).toBe(1); // a
    expect(f.customs).toBe(1); // b
    expect(f.delivered).toBe(1); // c (awaiting invoice)
    expect(f.archived).toBe(1); // d
  });

  it("flow counts exclude closed from operational nodes (counted as archive)", () => {
    const fl = flowCounts(rows);
    expect(fl.documentation).toBe(1); // a
    expect(fl.customs).toBe(1); // b
    expect(fl.archive).toBe(1); // d (closed)
  });

  it("aging buckets active dossiers by age", () => {
    const ag = agingBuckets(rows, NOW);
    // active: a(7)->6_10, b(1)->0_2, c(4)->3_5, e(20)->10p ; d closed excluded
    expect(ag).toEqual({ b0_2: 1, b3_5: 1, b6_10: 1, b10p: 1 });
  });

  it("detects bottlenecks", () => {
    const bn = bottlenecks(rows);
    const byKey = Object.fromEntries(bn.map((b) => [b.key, b.count]));
    expect(byKey.docs_blocked).toBe(1);
    expect(byKey.customs_inspection).toBe(1);
    expect(byKey.awaiting_pod).toBe(1);
    expect(byKey.overdue_invoices).toBe(1);
  });

  it("needs-attention excludes closed and ranks by priority then age", () => {
    const na = needsAttention(rows, NOW, 10);
    expect(na.some((i) => i.fileId === "d")).toBe(false); // closed excluded
    expect(na[0].priority).toBe("high"); // 'a' is high priority -> first
    expect(na.length).toBeLessThanOrEqual(10);
  });

  it("ageDays floors to whole days", () => {
    expect(ageDays(daysAgo(3), NOW)).toBe(3);
  });
});

describe("control-tower transportTimeKpis", () => {
  it("counts delivered-this-month and averages delivery duration", () => {
    const r = transportTimeKpis(
      [
        { pickupActual: daysAgo(4), deliveryActual: daysAgo(2) }, // this month, 2 days
        { pickupActual: daysAgo(10), deliveryActual: daysAgo(6) }, // this month, 4 days
        { pickupActual: null, deliveryActual: null }, // not delivered
      ],
      NOW,
    );
    expect(r.deliveredThisMonth).toBe(2);
    expect(r.avgDeliveryDays).toBe(3); // (2 + 4) / 2
  });
  it("returns null average when nothing delivered", () => {
    expect(transportTimeKpis([{ pickupActual: null, deliveryActual: null }], NOW).avgDeliveryDays).toBeNull();
  });
});

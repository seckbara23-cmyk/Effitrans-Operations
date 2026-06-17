import { describe, it, expect } from "vitest";
import { getDossierLifecycle, type LifecycleInput } from "@/lib/files/lifecycle";
import {
  toPortalTimeline,
  portalActivity,
  relativeLabel,
  portalShipmentCards,
  type PortalStageKey,
  type PortalStageStatus,
} from "@/lib/portal/progress-map";

function timeline(o: Partial<LifecycleInput>) {
  const lc = getDossierLifecycle({
    fileId: "f",
    file: o.file ?? { status: "OPENED", type: "IMP" },
    documents: o.documents ?? [],
    missingRequired: o.missingRequired ?? [],
    customs: o.customs ?? null,
    transport: o.transport ?? null,
    invoices: o.invoices ?? [],
    podApproved: o.podApproved ?? false,
  });
  return toPortalTimeline(lc.steps);
}
const status = (tl: ReturnType<typeof timeline>, key: PortalStageKey): PortalStageStatus =>
  tl.stages.find((s) => s.key === key)!.status;

describe("portal timeline mapping (internal lifecycle → customer stages)", () => {
  it("has exactly the 10 customer stages and never exposes internal keys", () => {
    const tl = timeline({});
    expect(tl.stages.map((s) => s.key)).toEqual([
      "created",
      "documents_received",
      "documents_verified",
      "customs_in_progress",
      "customs_done",
      "transport_planned",
      "in_transit",
      "delivered",
      "invoiced",
      "paid",
    ]);
    // No internal step keys / department / blocker / sla terms leak through.
    const serialized = JSON.stringify(tl);
    for (const leak of ["release_authorized", "customs_inspection", "FINANCE_HANDOFF", "blocked", "department", "warning"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("maps CUSTOMS_RELEASED → 'Dédouanement terminé' completed", () => {
    const tl = timeline({
      file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "RELEASED" },
      transport: { status: "NOT_STARTED" },
    });
    expect(status(tl, "customs_done")).toBe("completed");
    expect(status(tl, "transport_planned")).toBe("current");
  });

  it("only completed/current/pending — never blocked (missing docs still shows current, not blocked)", () => {
    const tl = timeline({ file: { status: "OPENED", type: "IMP" }, missingRequired: [{ label: "Facture" }] });
    const statuses = new Set(tl.stages.map((s) => s.status));
    expect([...statuses].every((s) => ["completed", "current", "pending"].includes(s))).toBe(true);
  });

  it("computes progress percentage and next step", () => {
    const tl = timeline({
      file: { status: "DELIVERED", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "RELEASED" },
      transport: { status: "POD_RECEIVED" },
      podApproved: true,
      invoices: [{ status: "ISSUED", balance: 100 }],
    });
    expect(status(tl, "invoiced")).toBe("completed");
    expect(tl.currentKey).toBe("paid");
    expect(tl.nextKey).toBeNull();
    expect(tl.percent).toBeGreaterThanOrEqual(90);
  });

  it("non-customs shipments flow past the customs stages (skipped → completed)", () => {
    const tl = timeline({
      file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "NOT_STARTED", required: false }, // customs not applicable -> internal skipped
      transport: { status: "NOT_STARTED" },
    });
    expect(status(tl, "customs_in_progress")).toBe("completed");
    expect(status(tl, "customs_done")).toBe("completed");
    expect(status(tl, "transport_planned")).toBe("current");
  });
});

describe("portalActivity", () => {
  it("lists completed milestones newest-first as stable keys", () => {
    const tl = timeline({
      file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "RELEASED" },
    });
    const act = portalActivity(tl);
    expect(act[0]).toBe("customs_done"); // most recent completed milestone first
    expect(act).toContain("documents_verified");
  });
});

describe("relativeLabel", () => {
  const NOW = new Date("2026-06-17T12:00:00.000Z");
  it("formats minutes / hours / days in French", () => {
    expect(relativeLabel(new Date(NOW.getTime() - 30 * 60_000).toISOString(), NOW)).toBe("il y a 30 min");
    expect(relativeLabel(new Date(NOW.getTime() - 2 * 3_600_000).toISOString(), NOW)).toBe("il y a 2 h");
    expect(relativeLabel(new Date(NOW.getTime() - 3 * 86_400_000).toISOString(), NOW)).toBe("il y a 3 j");
    expect(relativeLabel(null, NOW)).toBe("—");
  });
});

describe("portalShipmentCards", () => {
  it("counts active / in-transit / delivered / awaiting payment", () => {
    const files = [
      { status: "IN_PROGRESS", transportStatus: "IN_TRANSIT" },
      { status: "DELIVERED", transportStatus: "DELIVERED" },
      { status: "CLOSED", transportStatus: "POD_RECEIVED" },
      { status: "OPENED", transportStatus: null },
    ];
    const invoices = [
      { status: "ISSUED", balance: 500 },
      { status: "PAID", balance: 0 },
      { status: "PARTIALLY_PAID", balance: 200 },
    ];
    expect(portalShipmentCards(files, invoices)).toEqual({
      active: 3, // all except CLOSED
      inTransit: 1,
      delivered: 2, // DELIVERED + CLOSED(POD_RECEIVED)
      awaitingPayment: 2,
    });
  });
});

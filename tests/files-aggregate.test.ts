import { describe, it, expect } from "vitest";
import { aggregateFiles, type AggregateRow } from "@/lib/files/aggregate";

const NOW = new Date("2026-06-14T12:00:00Z");
const PAST = "2026-06-01T00:00:00Z";
const FUTURE = "2026-12-01T00:00:00Z";

const r = (over: Partial<AggregateRow>): AggregateRow => ({
  status: "OPENED",
  priority: "normal",
  transportMode: "SEA",
  eta: null,
  ...over,
});

describe("aggregateFiles", () => {
  const rows: AggregateRow[] = [
    r({ status: "DRAFT", priority: "low", transportMode: "ROAD" }),
    r({ status: "OPENED", priority: "high", transportMode: "SEA", eta: PAST }),
    r({ status: "IN_PROGRESS", priority: "critical", transportMode: "AIR", eta: PAST }),
    r({ status: "IN_PROGRESS", priority: "normal", transportMode: "MULTIMODAL", eta: FUTURE }),
    r({ status: "DELIVERED", priority: "high", transportMode: "SEA", eta: PAST }), // delivered => not overdue
    r({ status: "CLOSED", priority: "low", transportMode: null }), // mode none
  ];
  const o = aggregateFiles(rows, NOW);

  it("counts status buckets", () => {
    expect(o.byStatus).toEqual({ DRAFT: 1, OPENED: 1, IN_PROGRESS: 2, DELIVERED: 1, CLOSED: 1 });
    expect(o.opened).toBe(1);
    expect(o.inProgress).toBe(2);
    expect(o.delivered).toBe(1);
    expect(o.closed).toBe(1);
  });

  it("active = everything not closed", () => {
    expect(o.active).toBe(5);
  });

  it("high priority counts high + critical", () => {
    expect(o.highPriority).toBe(3);
  });

  it("overdue = ETA passed and not delivered/closed", () => {
    // OPENED+PAST and IN_PROGRESS+PAST qualify; DELIVERED+PAST does not.
    expect(o.overdueShipments).toBe(2);
  });

  it("breaks down by transport mode, with a 'none' bucket", () => {
    expect(o.byMode).toEqual({ SEA: 2, AIR: 1, ROAD: 1, MULTIMODAL: 1, none: 1 });
  });

  it("handles an empty list", () => {
    const e = aggregateFiles([], NOW);
    expect(e.active).toBe(0);
    expect(e.overdueShipments).toBe(0);
    expect(e.byStatus.CLOSED).toBe(0);
    expect(e.byMode.none).toBe(0);
  });
});

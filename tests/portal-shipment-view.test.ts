import { describe, it, expect } from "vitest";
import {
  toPortalRisk,
  classifyAvailability,
  documentCategory,
  groupDocuments,
  stageToMapPhase,
  toMajorPhases,
  formatShortDate,
  formatDayMonth,
} from "@/lib/portal/shipment-view";
import type { PortalStage } from "@/lib/portal/progress-map";

const NOW = new Date("2026-06-20T12:00:00.000Z");

describe("toPortalRisk (customer-safe risk view)", () => {
  it("collapses the internal 4 levels into 3 reassuring states", () => {
    expect(toPortalRisk("low")).toBe("on_track");
    expect(toPortalRisk("medium")).toBe("attention");
    expect(toPortalRisk("high")).toBe("delayed");
    expect(toPortalRisk("critical")).toBe("delayed");
  });
});

describe("classifyAvailability", () => {
  it("maps last-seen to online / recent / offline", () => {
    expect(classifyAvailability(null, NOW)).toBe("offline");
    expect(classifyAvailability("2026-06-20T11:58:00.000Z", NOW)).toBe("online"); // 2 min
    expect(classifyAvailability("2026-06-20T06:00:00.000Z", NOW)).toBe("recent"); // 6 h
    expect(classifyAvailability("2026-06-01T00:00:00.000Z", NOW)).toBe("offline"); // weeks
  });
});

describe("document grouping (Document Center)", () => {
  it("buckets by keyword into the 4 customer categories", () => {
    expect(documentCategory("CUSTOMS_DECLARATION")).toBe("customs");
    expect(documentCategory("BILL_OF_LADING")).toBe("transport");
    expect(documentCategory("DELIVERY_NOTE")).toBe("transport");
    expect(documentCategory("COMMERCIAL_INVOICE")).toBe("finance"); // INVOICE keyword → finance
    expect(documentCategory("PACKING_LIST")).toBe("commercial");
    expect(documentCategory("CERTIFICATE_OF_ORIGIN")).toBe("commercial");
  });
  it("groups documents preserving order", () => {
    const g = groupDocuments([
      { typeCode: "PACKING_LIST", id: 1 },
      { typeCode: "AWB", id: 2 },
      { typeCode: "DDU_CUSTOMS", id: 3 },
    ]);
    expect(g.commercial.map((d) => d.id)).toEqual([1]);
    expect(g.transport.map((d) => d.id)).toEqual([2]);
    expect(g.customs.map((d) => d.id)).toEqual([3]);
    expect(g.finance).toEqual([]);
  });
});

describe("stageToMapPhase", () => {
  it("maps the customer stage to a fixed map node", () => {
    expect(stageToMapPhase(null)).toBe("port");
    expect(stageToMapPhase("documents_verified")).toBe("port");
    expect(stageToMapPhase("customs_in_progress")).toBe("customs");
    expect(stageToMapPhase("transport_planned")).toBe("warehouse");
    expect(stageToMapPhase("in_transit")).toBe("transport");
    expect(stageToMapPhase("delivered")).toBe("client");
    expect(stageToMapPhase("paid")).toBe("client");
  });
});

describe("toMajorPhases (horizontal tracker view)", () => {
  const stage = (key: string, status: string): PortalStage => ({ key, status } as PortalStage);

  it("collapses 10 stages into 4 headline phases", () => {
    const stages: PortalStage[] = [
      stage("created", "completed"),
      stage("documents_received", "completed"),
      stage("documents_verified", "completed"),
      stage("customs_in_progress", "current"),
      stage("customs_done", "pending"),
      stage("transport_planned", "pending"),
      stage("in_transit", "pending"),
      stage("delivered", "pending"),
      stage("invoiced", "pending"),
      stage("paid", "pending"),
    ];
    const phases = toMajorPhases(stages);
    expect(phases.map((p) => `${p.key}:${p.status}`)).toEqual([
      "documentation:completed",
      "customs:current",
      "transport:pending",
      "delivery:pending",
    ]);
  });
});

describe("date formatting (locale-independent, UTC)", () => {
  it("formats short dates and day-month", () => {
    expect(formatShortDate("2026-06-14T00:00:00.000Z")).toBe("14/06/2026");
    expect(formatShortDate(null)).toBe("—");
    expect(formatDayMonth("2026-06-14T00:00:00.000Z")).toBe("14 juin");
  });
});

import { describe, it, expect } from "vitest";
import { capItems, isCriticalEventType, isUnsettledDocStatus } from "@/lib/copilot/compress";

type Ev = { id: number; critical: boolean };
const ev = (id: number, critical: boolean): Ev => ({ id, critical });

describe("capItems — deterministic compression that never drops criticals", () => {
  it("keeps everything when under the cap", () => {
    const items = [ev(1, false), ev(2, true), ev(3, false)];
    const r = capItems(items, 5, (e) => e.critical);
    expect(r.items).toHaveLength(3);
    expect(r.omitted).toBe(0);
  });

  it("keeps ALL criticals + fills the remaining budget with the earliest routine items", () => {
    // 3 critical + 7 routine, cap 5 → 3 critical + first 2 routine = 5 kept, 5 omitted.
    const items = [
      ev(1, false), ev(2, true), ev(3, false), ev(4, true), ev(5, false),
      ev(6, false), ev(7, true), ev(8, false), ev(9, false), ev(10, false),
    ];
    const r = capItems(items, 5, (e) => e.critical);
    expect(r.items).toHaveLength(5);
    expect(r.omitted).toBe(5);
    // every critical survives
    expect(r.items.filter((e) => e.critical).map((e) => e.id)).toEqual([2, 4, 7]);
    // routine kept are the earliest two (id 1 and 3), and original order is preserved
    expect(r.items.map((e) => e.id)).toEqual([1, 2, 3, 4, 7]);
  });

  it("never drops a critical even when criticals alone exceed the cap", () => {
    const items = [ev(1, true), ev(2, true), ev(3, true), ev(4, true), ev(5, true), ev(6, true), ev(7, false)];
    const r = capItems(items, 3, (e) => e.critical);
    expect(r.items).toHaveLength(6); // all criticals kept, exceeds cap intentionally
    expect(r.items.every((e) => e.critical)).toBe(true);
    expect(r.omitted).toBe(1); // only the routine one dropped
  });
});

describe("critical-fact classifiers", () => {
  it("flags material tracking events as critical", () => {
    for (const t of ["INCIDENT_REPORTED", "DELAY_REPORTED", "DELIVERED", "DELIVERY_ATTEMPTED", "POD_RECEIVED", "CUSTOMS_STOP", "BORDER_REACHED"]) {
      expect(isCriticalEventType(t)).toBe(true);
    }
  });
  it("treats routine progress events as non-critical", () => {
    for (const t of ["DEPARTED", "CHECKPOINT_REACHED", "TRACKING_STARTED", "WAREHOUSE_REACHED"]) {
      expect(isCriticalEventType(t)).toBe(false);
    }
  });
  it("keeps unsettled documents (still need attention) through compression", () => {
    expect(isUnsettledDocStatus("PENDING_REVIEW")).toBe(true);
    expect(isUnsettledDocStatus("REJECTED")).toBe(true);
    expect(isUnsettledDocStatus("EXPIRED")).toBe(true);
    expect(isUnsettledDocStatus("APPROVED")).toBe(false);
  });
});

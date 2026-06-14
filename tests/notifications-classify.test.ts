import { describe, it, expect } from "vitest";
import { classifyDue } from "@/lib/notifications/classify";

const NOW = new Date("2026-06-14T12:00:00Z");

describe("classifyDue", () => {
  it("returns 'none' without a due date", () => {
    expect(classifyDue(null, "TODO", NOW)).toBe("none");
    expect(classifyDue(undefined, "IN_PROGRESS", NOW)).toBe("none");
  });

  it("returns 'none' for terminal tasks regardless of due date", () => {
    expect(classifyDue("2026-06-01T00:00:00Z", "DONE", NOW)).toBe("none");
    expect(classifyDue("2026-06-01T00:00:00Z", "CANCELLED", NOW)).toBe("none");
  });

  it("flags a past due date as overdue", () => {
    expect(classifyDue("2026-06-13T23:59:00Z", "TODO", NOW)).toBe("overdue");
    expect(classifyDue("2026-01-01T00:00:00Z", "BLOCKED", NOW)).toBe("overdue");
  });

  it("flags same-day due dates as today (start and end of day inclusive)", () => {
    expect(classifyDue("2026-06-14T00:00:00Z", "TODO", NOW)).toBe("today");
    expect(classifyDue("2026-06-14T23:00:00Z", "IN_PROGRESS", NOW)).toBe("today");
  });

  it("flags a future due date as upcoming", () => {
    expect(classifyDue("2026-06-15T00:00:00Z", "TODO", NOW)).toBe("upcoming");
    expect(classifyDue("2026-12-01T00:00:00Z", "TODO", NOW)).toBe("upcoming");
  });

  it("returns 'none' for an unparseable date", () => {
    expect(classifyDue("not-a-date", "TODO", NOW)).toBe("none");
  });
});

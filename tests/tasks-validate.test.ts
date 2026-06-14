import { describe, it, expect } from "vitest";
import { validateTask } from "@/lib/tasks/validate";
import { canTransition, activeTargets, isTaskStatus } from "@/lib/tasks/status";

describe("validateTask", () => {
  it("requires a title", () => {
    expect(validateTask({ title: "" })).toBe("title_required");
    expect(validateTask({ title: "  " })).toBe("title_required");
    expect(validateTask({ title: "Prepare DPI" })).toBeNull();
  });

  it("validates priority, due date, assignee", () => {
    expect(validateTask({ title: "x", priority: "URGENT" })).toBeNull();
    // @ts-expect-error invalid priority
    expect(validateTask({ title: "x", priority: "MEGA" })).toBe("invalid_priority");
    expect(validateTask({ title: "x", dueAt: "not-a-date" })).toBe("invalid_due_date");
    expect(validateTask({ title: "x", dueAt: "2026-06-20" })).toBeNull();
    expect(validateTask({ title: "x", assignedTo: "nope" })).toBe("invalid_assignee");
  });
});

describe("task state machine", () => {
  it("active states move freely among active + terminal", () => {
    expect(canTransition("TODO", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "BLOCKED")).toBe(true);
    expect(canTransition("BLOCKED", "DONE")).toBe(true);
    expect(canTransition("TODO", "CANCELLED")).toBe(true);
  });

  it("terminal states only reopen", () => {
    expect(canTransition("DONE", "IN_PROGRESS")).toBe(true);
    expect(canTransition("CANCELLED", "TODO")).toBe(true);
    expect(canTransition("DONE", "BLOCKED")).toBe(false);
    expect(canTransition("CANCELLED", "DONE")).toBe(false);
  });

  it("activeTargets excludes terminal statuses", () => {
    expect(activeTargets("TODO").sort()).toEqual(["BLOCKED", "IN_PROGRESS"]);
    expect(activeTargets("DONE")).toEqual(["IN_PROGRESS"]);
    expect(isTaskStatus("BLOCKED")).toBe(true);
    expect(isTaskStatus("PARKED")).toBe(false);
  });
});

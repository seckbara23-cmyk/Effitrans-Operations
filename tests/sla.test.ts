import { describe, it, expect } from "vitest";
import { SLA_THRESHOLDS } from "@/lib/sla/config";
import { classifySla, toSlaDept } from "@/lib/sla/classify";
import { stageDuration } from "@/lib/sla/stage-duration";
import {
  slaCountsByDept,
  slaSummary,
  delayedDossiers,
  bottleneckRanking,
  averageDays,
  type SlaRow,
} from "@/lib/sla/aggregate";

const NOW = new Date("2026-06-17T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("SLA config thresholds", () => {
  it("matches the documented defaults (hours)", () => {
    expect(SLA_THRESHOLDS.documentation).toEqual({ warningHours: 48, criticalHours: 96 });
    expect(SLA_THRESHOLDS.customs).toEqual({ warningHours: 72, criticalHours: 144 });
    expect(SLA_THRESHOLDS.transport).toEqual({ warningHours: 24, criticalHours: 72 });
    expect(SLA_THRESHOLDS.finance).toEqual({ warningHours: 168, criticalHours: 720 });
    expect(SLA_THRESHOLDS.archive).toBeNull();
  });
});

describe("classifySla (boundaries per department)", () => {
  it("documentation: normal < 48h, warning >= 48h, critical >= 96h", () => {
    expect(classifySla("documentation", 36)).toBe("normal");
    expect(classifySla("documentation", 47.9)).toBe("normal");
    expect(classifySla("documentation", 48)).toBe("warning"); // boundary inclusive
    expect(classifySla("documentation", 60)).toBe("warning");
    expect(classifySla("documentation", 96)).toBe("critical"); // boundary inclusive
    expect(classifySla("documentation", 110)).toBe("critical");
  });
  it("transport boundaries (24h / 72h)", () => {
    expect(classifySla("transport", 23)).toBe("normal");
    expect(classifySla("transport", 24)).toBe("warning");
    expect(classifySla("transport", 72)).toBe("critical");
  });
  it("archive is informational, opening/null is normal", () => {
    expect(classifySla("archive", 999)).toBe("informational");
    expect(classifySla("opening", 999)).toBe("normal");
    expect(classifySla(null, 999)).toBe("normal");
  });
  it("toSlaDept narrows correctly", () => {
    expect(toSlaDept("customs")).toBe("customs");
    expect(toSlaDept("opening")).toBeNull();
    expect(toSlaDept(null)).toBeNull();
  });
});

describe("stageDuration (derived from existing timestamps)", () => {
  const base = {
    now: NOW,
    currentStage: "documents_verified",
    fileCreatedAt: hoursAgo(200),
    fileOpenedAt: hoursAgo(60),
    fileUpdatedAt: hoursAgo(5),
    customsUpdatedAt: hoursAgo(30),
    transportUpdatedAt: hoursAgo(10),
    invoiceUpdatedAt: hoursAgo(2),
  };
  it("documentation uses opened-at", () => {
    const r = stageDuration({ ...base, currentDepartment: "documentation" });
    expect(r.enteredAt).toBe(base.fileOpenedAt);
    expect(r.ageHours).toBe(60);
    expect(r.ageDays).toBe(2);
  });
  it("customs uses customs updated-at", () => {
    const r = stageDuration({ ...base, currentDepartment: "customs" });
    expect(r.ageHours).toBe(30);
  });
  it("finance uses invoice updated-at", () => {
    const r = stageDuration({ ...base, currentDepartment: "finance" });
    expect(r.ageHours).toBe(2);
  });
  it("falls back to created-at when no stage timestamp", () => {
    const r = stageDuration({ ...base, currentDepartment: "documentation", fileOpenedAt: null });
    expect(r.enteredAt).toBe(base.fileCreatedAt);
    expect(r.ageHours).toBe(200);
  });
});

describe("SLA aggregation", () => {
  const mk = (o: Partial<SlaRow>): SlaRow => ({
    fileId: o.fileId ?? "x",
    fileNumber: o.fileId ?? "x",
    clientName: "C",
    department: o.department ?? "documentation",
    stage: "documents_verified",
    sla: o.sla ?? "normal",
    ageHours: o.ageHours ?? 1,
    daysWaiting: o.daysWaiting ?? 0,
    nextAction: "",
    priority: o.priority ?? "normal",
    fileStatus: o.fileStatus ?? "IN_PROGRESS",
  });

  const rows: SlaRow[] = [
    mk({ fileId: "a", department: "documentation", sla: "critical", ageHours: 120 }),
    mk({ fileId: "b", department: "documentation", sla: "warning", ageHours: 60 }),
    mk({ fileId: "c", department: "documentation", sla: "normal", ageHours: 10 }),
    mk({ fileId: "d", department: "customs", sla: "warning", ageHours: 80 }),
    mk({ fileId: "e", department: "finance", sla: "critical", ageHours: 900 }),
    mk({ fileId: "f", department: "transport", sla: "normal", ageHours: 5, fileStatus: "CLOSED" }), // excluded
  ];

  it("counts SLA by department (excludes closed)", () => {
    const c = slaCountsByDept(rows);
    expect(c.documentation).toEqual({ normal: 1, warning: 1, critical: 1 });
    expect(c.customs).toEqual({ normal: 0, warning: 1, critical: 0 });
    expect(c.finance).toEqual({ normal: 0, warning: 0, critical: 1 });
    expect(c.transport).toEqual({ normal: 0, warning: 0, critical: 0 }); // closed row excluded
  });

  it("delayed queue: critical first, then longest waiting, warning+critical only", () => {
    const q = delayedDossiers(rows);
    expect(q.map((r) => r.fileId)).toEqual(["e", "a", "d", "b"]); // e(crit 900) a(crit 120) d(warn 80) b(warn 60)
    expect(q.every((r) => r.sla !== "normal")).toBe(true);
  });

  it("bottleneck ranking by critical then warning", () => {
    const rank = bottleneckRanking(rows);
    // documentation (1 critical + 1 warning) outranks finance (1 critical, 0 warning) on the tiebreak
    expect(rank[0].department).toBe("documentation");
    expect(rank.find((r) => r.department === "finance")?.critical).toBe(1);
    expect(rank.find((r) => r.department === "transport")).toBeUndefined(); // no delays
  });

  it("slaSummary tallies a row set", () => {
    expect(slaSummary([{ sla: "warning" }, { sla: "critical" }, { sla: "normal" }, { sla: "informational" }])).toEqual({
      normal: 1,
      warning: 1,
      critical: 1,
    });
  });

  it("averageDays computes mean and returns null when no data", () => {
    expect(averageDays([{ start: hoursAgo(48), end: hoursAgo(0) }])).toBe(2);
    expect(averageDays([{ start: null, end: hoursAgo(0) }])).toBeNull();
    expect(averageDays([])).toBeNull();
  });
});

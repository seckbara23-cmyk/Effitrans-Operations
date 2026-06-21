import { describe, it, expect } from "vitest";
import {
  assessRisk,
  riskLevel,
  rankAttention,
  riskKpis,
  overdueDays,
  type RiskInput,
  type DossierRiskRow,
  type RiskAssessment,
} from "@/lib/copilot/risk-engine";

const EMPTY: RiskInput = {
  lifecycle: { currentDepartment: "documentation", nextAction: "Collecter les documents" },
  sla: { status: "normal" },
  documents: { missingRequiredCount: 0 },
  customs: null,
  transport: null,
  finance: null,
};

function input(overrides: Partial<RiskInput>): RiskInput {
  return { ...EMPTY, ...overrides };
}

describe("riskLevel thresholds", () => {
  it("maps score bands to levels (boundaries inclusive)", () => {
    expect(riskLevel(0)).toBe("low");
    expect(riskLevel(19)).toBe("low");
    expect(riskLevel(20)).toBe("medium");
    expect(riskLevel(49)).toBe("medium");
    expect(riskLevel(50)).toBe("high");
    expect(riskLevel(79)).toBe("high");
    expect(riskLevel(80)).toBe("critical");
    expect(riskLevel(100)).toBe("critical");
  });
});

describe("assessRisk — LOW", () => {
  it("clean dossier scores 0 / low with a no-risk reason", () => {
    const r = assessRisk(EMPTY);
    expect(r.score).toBe(0);
    expect(r.level).toBe("low");
    expect(r.reasons).toEqual(["Aucun risque détecté."]);
    expect(r.actions).toEqual([]); // no next-step nudge when low
  });
});

describe("assessRisk — documents", () => {
  it("one missing document → +20 (medium)", () => {
    const r = assessRisk(input({ documents: { missingRequiredCount: 1 } }));
    expect(r.score).toBe(20);
    expect(r.level).toBe("medium");
    expect(r.reasons[0]).toMatch(/document requis est manquant/i);
  });

  it("multiple missing documents → +40 (medium, higher tier)", () => {
    const r = assessRisk(input({ documents: { missingRequiredCount: 3 } }));
    expect(r.score).toBe(40);
    expect(r.level).toBe("medium");
    expect(r.reasons[0]).toContain("3 documents");
  });
});

describe("assessRisk — SLA breach", () => {
  it("warning → +15", () => {
    expect(assessRisk(input({ sla: { status: "warning" } })).score).toBe(15);
  });
  it("critical → +35", () => {
    const r = assessRisk(input({ sla: { status: "critical" } }));
    expect(r.score).toBe(35);
    expect(r.reasons[0]).toMatch(/critique/i);
  });
});

describe("assessRisk — customs delay", () => {
  it("under inspection → +15", () => {
    const r = assessRisk(input({ customs: { underInspection: true, inspectionDays: 2 } }));
    expect(r.score).toBe(15);
    expect(r.reasons[0]).toMatch(/inspection douanière/i);
  });
  it("inspection > 5 days → +30 (supersedes plain inspection)", () => {
    const r = assessRisk(input({ customs: { underInspection: true, inspectionDays: 9 } }));
    expect(r.score).toBe(30);
    expect(r.reasons[0]).toContain("9 jours");
  });
  it("not under inspection contributes nothing", () => {
    expect(assessRisk(input({ customs: { underInspection: false, inspectionDays: 99 } })).score).toBe(0);
  });
});

describe("assessRisk — transport delay", () => {
  it("awaiting POD → +15", () => {
    expect(assessRisk(input({ transport: { awaitingPod: true, transitExceedsSla: false } })).score).toBe(15);
  });
  it("transit exceeds SLA → +25", () => {
    expect(assessRisk(input({ transport: { awaitingPod: false, transitExceedsSla: true } })).score).toBe(25);
  });
  it("both transport conditions are additive → +40", () => {
    const r = assessRisk(input({ transport: { awaitingPod: true, transitExceedsSla: true } }));
    expect(r.score).toBe(40);
  });
});

describe("assessRisk — overdue invoice", () => {
  it("overdue ≤ 30 days → +20", () => {
    const r = assessRisk(input({ finance: { overdueCount: 1, maxOverdueDays: 10 } }));
    expect(r.score).toBe(20);
    expect(r.reasons[0]).toMatch(/en retard/i);
  });
  it("overdue > 30 days → +40 (higher tier)", () => {
    const r = assessRisk(input({ finance: { overdueCount: 2, maxOverdueDays: 45 } }));
    expect(r.score).toBe(40);
    expect(r.reasons[0]).toContain("plus de 30 jours");
  });
  it("no overdue invoices contributes nothing", () => {
    expect(assessRisk(input({ finance: { overdueCount: 0, maxOverdueDays: null } })).score).toBe(0);
  });
});

describe("assessRisk — combined scoring", () => {
  it("HIGH: many missing docs (40) + critical SLA (35) = 75", () => {
    const r = assessRisk(
      input({ documents: { missingRequiredCount: 2 }, sla: { status: "critical" } }),
    );
    expect(r.score).toBe(75);
    expect(r.level).toBe("high");
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
    // a HIGH dossier gets the lifecycle next-step nudge appended
    expect(r.actions.some((a) => a.startsWith("Prochaine étape recommandée"))).toBe(true);
  });

  it("CRITICAL: docs(40) + sla critical(35) + overdue>30(40) caps at 100", () => {
    const r = assessRisk(
      input({
        documents: { missingRequiredCount: 5 },
        sla: { status: "critical" },
        finance: { overdueCount: 1, maxOverdueDays: 60 },
        transport: { awaitingPod: true, transitExceedsSla: false },
      }),
    );
    expect(r.score).toBe(100); // 40+35+40+15 = 130 → capped at 100
    expect(r.level).toBe("critical");
  });

  it("MEDIUM: single overdue invoice alone = 20", () => {
    const r = assessRisk(input({ finance: { overdueCount: 1, maxOverdueDays: 5 } }));
    expect(r.level).toBe("medium");
  });

  it("deduplicates identical recommended actions", () => {
    const r = assessRisk(
      input({ documents: { missingRequiredCount: 2 }, sla: { status: "warning" } }),
    );
    expect(new Set(r.actions).size).toBe(r.actions.length);
  });
});

describe("overdueDays", () => {
  const now = new Date("2026-06-21T00:00:00.000Z");
  it("returns 0 for null / future / unparseable", () => {
    expect(overdueDays(null, now)).toBe(0);
    expect(overdueDays("2026-07-01", now)).toBe(0);
    expect(overdueDays("not-a-date", now)).toBe(0);
  });
  it("counts whole days past due", () => {
    expect(overdueDays("2026-06-11", now)).toBe(10);
  });
});

describe("rankAttention", () => {
  const mk = (id: string, level: RiskAssessment["level"], ageDays: number, priority = "normal"): DossierRiskRow => ({
    fileId: id,
    fileNumber: id,
    clientName: null,
    department: "customs",
    priority,
    ageDays,
    assessment: { level, score: level === "critical" ? 90 : level === "high" ? 60 : 30, reasons: [`reason-${id}`], actions: [] },
  });

  it("includes only high/critical, ranks critical first then by age", () => {
    const out = rankAttention([
      mk("a", "high", 2),
      mk("b", "critical", 1),
      mk("c", "medium", 99),
      mk("d", "critical", 5),
    ]);
    expect(out.map((o) => o.fileId)).toEqual(["d", "b", "a"]); // medium excluded; criticals first (older first)
    expect(out[0].primaryReason).toBe("reason-d");
  });

  it("caps at the limit", () => {
    const rows = Array.from({ length: 15 }, (_, i) => mk(`f${i}`, "high", i));
    expect(rankAttention(rows, 10)).toHaveLength(10);
  });
});

describe("riskKpis", () => {
  const rows: DossierRiskRow[] = [
    { fileId: "1", fileNumber: "1", clientName: null, department: null, priority: "normal", ageDays: 1, assessment: { level: "critical", score: 90, reasons: [], actions: [] } },
    { fileId: "2", fileNumber: "2", clientName: null, department: null, priority: "normal", ageDays: 1, assessment: { level: "high", score: 60, reasons: [], actions: [] } },
    { fileId: "3", fileNumber: "3", clientName: null, department: null, priority: "normal", ageDays: 1, assessment: { level: "low", score: 0, reasons: [], actions: [] } },
  ];
  it("counts critical/high and passes through sla/finance breaches", () => {
    expect(riskKpis(rows, 4, 7)).toEqual({ critical: 1, high: 1, slaBreaches: 4, overdueFinance: 7 });
  });
  it("allows a null overdueFinance (no finance access)", () => {
    expect(riskKpis(rows, 0, null).overdueFinance).toBeNull();
  });
});

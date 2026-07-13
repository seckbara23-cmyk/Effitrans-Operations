/**
 * Phase 5.0C-1 — official queue registry + deterministic priority model.
 */
import { describe, it, expect } from "vitest";
import {
  QUEUES,
  QUEUE_KEYS,
  getQueue,
  isQueueKey,
  queueForStep,
  queueStepKeys,
  visibleQueues,
} from "@/lib/process/queues/registry";
import { compareQueueItems, evaluatePriority, type PrioritySignals } from "@/lib/process/queues/priority";
import { EFFITRANS_PROCESS, PARALLEL_ACTIVITIES } from "@/lib/process/effitrans-process";
import { getTenantRoleTemplate } from "@/lib/platform/role-templates";

const ALL_NODES = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES];

describe("official queue registry — the 15 department queues", () => {
  it("declares exactly the 15 official queues", () => {
    expect(QUEUES).toHaveLength(15);
    expect(QUEUE_KEYS).toEqual([
      "cotation",
      "operations",
      "account_management",
      "coordination",
      "transit",
      "customs_declaration",
      "finance_customs",
      "customs_field",
      "transport",
      "pickup",
      "billing",
      "finance",
      "administration",
      "courier",
      "collections",
    ]);
  });

  it("maps EVERY official step to exactly one queue — none orphaned, none duplicated", () => {
    const seen = new Map<string, string>();
    for (const q of QUEUES) {
      for (const stepKey of queueStepKeys(q.key)) {
        expect(seen.has(stepKey), `${stepKey} claimed by two queues`).toBe(false);
        seen.set(stepKey, q.key);
      }
    }
    // All 26 steps + 3 parallel activities are covered.
    expect(seen.size).toBe(29);
    for (const n of ALL_NODES) {
      expect(seen.has(n.key), `${n.key} belongs to no queue`).toBe(true);
    }
  });

  it("derives step->queue from the 5.0A registry (no second mapping)", () => {
    // The queue a step belongs to IS its registry department. If someone changes
    // the registry, the queue follows — it cannot drift.
    for (const n of ALL_NODES) {
      expect(queueForStep(n.key)).toBe(n.department);
    }
  });

  it("gives each queue the official role its steps require", () => {
    for (const q of QUEUES) {
      for (const stepKey of queueStepKeys(q.key)) {
        const node = ALL_NODES.find((n) => n.key === stepKey)!;
        expect(node.role, `${stepKey} in ${q.key}`).toBe(q.officialRole);
      }
    }
  });

  it("staffs every queue with roles that actually exist", () => {
    for (const q of QUEUES) {
      for (const role of q.roles) {
        expect(getTenantRoleTemplate(role), `${q.key} -> ${role}`).toBeDefined();
      }
    }
  });

  it("guards queue keys", () => {
    expect(isQueueKey("coordination")).toBe(true);
    expect(isQueueKey("not_a_queue")).toBe(false);
    expect(getQueue("nope")).toBeNull();
  });
});

describe("queue role boundaries", () => {
  it("keeps Billing and Finance-validation as SEPARATE queues (the maker-checker split)", () => {
    const billing = getQueue("billing")!;
    const finance = getQueue("finance")!;
    expect(billing.key).not.toBe(finance.key);
    // The maker queue does not offer approval; the checker queue does.
    expect(billing.actions).not.toContain("approve");
    expect(finance.actions).toContain("approve");
    expect(finance.actions).toContain("reject");
    // And they are staffed by different roles.
    expect(billing.roles).toContain("BILLING_OFFICER");
    expect(billing.roles).not.toContain("FINANCE_OFFICER");
    expect(finance.roles).toContain("FINANCE_OFFICER");
    expect(finance.roles).not.toContain("BILLING_OFFICER");
  });

  it("gives the Courier NO financial mutation whatsoever", () => {
    const courier = getQueue("courier")!;
    expect(courier.actions).not.toContain("approve");
    expect(courier.actions).not.toContain("reject");
    // And the role itself holds no finance permission (5.0B invariant, re-asserted).
    const role = getTenantRoleTemplate("COURIER")!;
    expect(role.permissions.some((p) => p.startsWith("finance:"))).toBe(false);
  });

  it("requires explicit reception on every queue whose work arrives by handoff", () => {
    // Cotation and Intake begin the process; Finance-validation is pulled, not pushed.
    expect(getQueue("cotation")!.requiresReception).toBe(false);
    expect(getQueue("operations")!.requiresReception).toBe(false);
    // Every downstream operational queue must confirm reception — no silent progression.
    for (const key of ["coordination", "transit", "customs_declaration", "finance_customs", "customs_field", "transport", "pickup", "billing", "administration", "courier", "collections"]) {
      expect(getQueue(key)!.requiresReception, key).toBe(true);
      expect(getQueue(key)!.actions).toContain("receive_handoff");
    }
  });

  it("shows a user only the queues their roles staff", () => {
    const perms = ["process:read"];
    expect(visibleQueues(["COURIER"], perms).map((q) => q.key)).toEqual(["courier"]);
    expect(visibleQueues(["CUSTOMS_DECLARANT"], perms).map((q) => q.key)).toEqual(["customs_declaration"]);
    expect(visibleQueues(["CHIEF_OF_TRANSIT"], perms).map((q) => q.key)).toEqual(["transit"]);

    const am = visibleQueues(["ACCOUNT_MANAGER"], perms).map((q) => q.key);
    expect(am).toEqual(["account_management"]);

    // A supervisor sees the cross-department view.
    expect(visibleQueues(["OPS_SUPERVISOR"], perms).length).toBeGreaterThan(10);
  });

  it("shows NOTHING without process:read, whatever the role", () => {
    expect(visibleQueues(["OPS_SUPERVISOR", "SYSTEM_ADMIN"], [])).toEqual([]);
  });

  it("never surfaces a queue to a driver or a portal user (no roles, no perms)", () => {
    expect(visibleQueues(["DRIVER"], ["tracking:read", "tracking:write"])).toEqual([]);
    expect(visibleQueues(["CLIENT_USER"], [])).toEqual([]);
  });
});

// ------------------------------------------------------------------ priority ----

const base: PrioritySignals = {
  filePriority: "normal",
  isCorrection: false,
  handoffUnreceived: false,
  ageHours: 0,
  slaPolicyKey: "coordinator_reception", // an UNCONFIGURED policy
  blocked: false,
  nearlyReady: false,
  podMissing: false,
  billingIdle: false,
  invoiceOverdue: false,
  customerImpacting: false,
};

describe("priority model (Deliverable 12) — deterministic, explainable, no invented SLA", () => {
  it("scores nothing when nothing is wrong", () => {
    const r = evaluatePriority(base);
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual([]);
    expect(r.level).toBe("low");
  });

  it("is deterministic — same inputs, same score", () => {
    const a = evaluatePriority({ ...base, isCorrection: true, blocked: true });
    const b = evaluatePriority({ ...base, isCorrection: true, blocked: true });
    expect(a).toEqual(b);
  });

  it("always exposes WHY an item is prioritized", () => {
    const r = evaluatePriority({ ...base, isCorrection: true, handoffUnreceived: true });
    expect(r.reasons.map((x) => x.code)).toEqual(["correction_required", "handoff_unreceived"]);
    expect(r.reasons.every((x) => x.labelFr.length > 0)).toBe(true);
    expect(r.score).toBe(90);
    expect(r.level).toBe("critical");
  });

  it("ranks a rejected/correction item above an idle one", () => {
    const correction = evaluatePriority({ ...base, isCorrection: true });
    const idle = evaluatePriority({ ...base, billingIdle: true });
    expect(correction.score).toBeGreaterThan(idle.score);
  });

  it("NEVER fabricates an overdue status from an unconfigured SLA policy", () => {
    // 10 000 hours old on a policy with no value => still nothing.
    const r = evaluatePriority({ ...base, ageHours: 10_000, slaPolicyKey: "coordinator_reception" });
    expect(r.reasons.some((x) => x.code.includes("threshold"))).toBe(false);
    expect(r.score).toBe(0);
  });

  it("labels the four legacy thresholds as PROVISIONAL and unratified, never as an SLA breach", () => {
    const r = evaluatePriority({ ...base, ageHours: 200, slaPolicyKey: "customs_preparation" });
    const reason = r.reasons.find((x) => x.code === "provisional_threshold_exceeded");
    expect(reason).toBeDefined();
    expect(reason!.labelFr).toContain("provisoire");
    expect(reason!.labelFr).toContain("non ratifié");
  });

  it("honours the dossier's explicit operational priority", () => {
    expect(evaluatePriority({ ...base, filePriority: "critical" }).score).toBe(40);
    expect(evaluatePriority({ ...base, filePriority: "low" }).score).toBe(-10);
  });

  it("sorts by score, then oldest, then dossier number — stable and total", () => {
    const mk = (score: number, ageHours: number, fileNumber: string) => ({
      priority: { score, reasons: [], level: "normal" as const },
      ageHours,
      fileNumber,
    });
    const rows = [mk(10, 5, "B"), mk(50, 1, "A"), mk(10, 9, "C"), mk(10, 5, "A")];
    const sorted = [...rows].sort(compareQueueItems).map((r) => `${r.priority.score}/${r.ageHours}/${r.fileNumber}`);
    expect(sorted).toEqual(["50/1/A", "10/9/C", "10/5/A", "10/5/B"]);
  });
});

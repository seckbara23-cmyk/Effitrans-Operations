/**
 * Pending-reception queue projection (FIN-UAT, ratified 2026-08-23).
 * ---------------------------------------------------------------------------
 * A dossier awaiting departmental reception vanished from `/queues/transit` and
 * from « À réceptionner » while `/departments/queue` showed it. Neither surface
 * was lying: they read different truths. The process queue selects executions
 * `.in("state", OPEN_STATES)`, and OPEN_STATES has never contained PENDING —
 * yet a step awaiting reception is PENDING *by construction*, because
 * `receiveHandoff` is what makes it AVAILABLE. So the tab could never show the
 * one thing it exists to show.
 *
 * The fix unions in the executions that are the target of a currently SENT
 * handoff — the same fact `/departments/queue` reads and the same fact
 * migration 121 grants visibility on — and nothing else. PENDING is NOT added
 * to OPEN_STATES: a pending step with no handoff behind it stays invisible.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { OPEN_STATES } from "@/lib/process/engine/types";
import { queueForStep, queueStepKeys, visibleQueues } from "@/lib/process/queues/registry";
import { classifyItem, buildWorkbench, actionableCount, type WorkbenchItem } from "@/lib/navigation/workbench";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const service = read("../lib/process/queues/service.ts");

/** The candidate-selection region only — never the whole 700-line service. */
function unionSlice(): string {
  const start = service.indexOf("// (1b) UNION");
  const end = service.indexOf("if (execs.length === 0)", start);
  expect(start, "union block not found").toBeGreaterThan(-1);
  expect(end, "slice boundary moved").toBeGreaterThan(start);
  return service.slice(start, end);
}

/** How the service composes an item for a step awaiting reception. */
function receptionItem(over: Partial<WorkbenchItem> = {}): WorkbenchItem {
  return {
    stepKey: "coordinator_reception",
    state: "PENDING",
    assigneeId: null,
    submittedBy: null,
    receptionRequired: true,
    received: false,
    isCorrection: false,
    blockerSummary: null,
    branches: { waitingOnOtherBranch: false },
    priority: { score: 10 },
    queueKey: "transit",
    ...(over as object),
  } as unknown as WorkbenchItem;
}

describe("pending reception — inclusion rule", () => {
  it("PENDING is NOT added to OPEN_STATES", () => {
    expect([...OPEN_STATES]).toEqual(["AVAILABLE", "ACTIVE", "BLOCKED", "SUBMITTED"]);
    expect([...OPEN_STATES]).not.toContain("PENDING");
    // The base query still filters on OPEN_STATES — existing behaviour intact.
    expect(service).toContain('.in("state", req.filters?.rejected ? ["REJECTED"] : [...OPEN_STATES])');
  });

  it("unions ONLY executions targeted by a currently SENT handoff", () => {
    const u = unionSlice();
    expect(u).toContain('.eq("status", "SENT")');
    expect(u).toContain('scopedFrom(admin, "process_handoff", req.tenantId)');
    // Restricted to THIS queue's steps — a handoff to another department's step
    // must not drag the dossier into this queue.
    expect(u).toContain('.in("to_step_key", req.filters?.stepKey ? [req.filters.stepKey] : stepKeys)');
    // No blanket widening anywhere in the union.
    expect(u).not.toContain('"PENDING"');
    expect(u).not.toMatch(/\.in\("state"/);
  });

  it("guards the cartesian product of the two `.in()` filters", () => {
    const u = unionSlice();
    // `.in(instances).in(steps)` returns every combination; only the pairs an
    // actual handoff points at may be admitted.
    expect(u).toContain("if (!awaited.get(inst)?.has(step)) continue;");
    // …and never double-counts a row the base query already returned.
    expect(u).toContain("if (seen.has(key)) continue;");
    // Terminal states are not resurrected by a stale handoff.
    expect(u).toContain('if (e.state === "REJECTED" || e.state === "CANCELLED") continue;');
  });

  it("does not disturb the rejected-filter lane or dossier scoping", () => {
    const u = unionSlice();
    expect(u).toContain("if (!req.filters?.rejected) {");
    // Tenant scoping via the same helper as every other read.
    expect((u.match(/scopedFrom\(admin, "process_/g) ?? []).length).toBe(2);
    // Dossier visibility is still applied downstream, unchanged.
    expect(service).toContain("scope.all || scope.ids.includes(id)");
  });
});

describe("pending reception — downstream classification is untouched", () => {
  const me = "chef-transit";

  it("the unioned item lands in « À réceptionner » with count 1", () => {
    expect(classifyItem(receptionItem(), me)).toBe("to_receive");
    const tabs = buildWorkbench([receptionItem()], me);
    const tab = tabs.find((t) => t.key === "to_receive")!;
    expect(tab.items).toHaveLength(1);
    expect(actionableCount(tabs)).toBe(1);
    // Exactly one tab — the partition that makes the badge honest.
    expect(tabs.filter((t) => t.items.length > 0).map((t) => t.key)).toEqual(["to_receive"]);
  });

  it("once RECEIVED it leaves « À réceptionner »", () => {
    // `received` is computed as `!openHandoff`, so reception flips it.
    const received = receptionItem({ received: true });
    expect(classifyItem(received, me)).not.toBe("to_receive");
    expect(buildWorkbench([received], me).find((t) => t.key === "to_receive")!.items).toHaveLength(0);
  });

  it("a PENDING step with NO handoff behind it stays invisible", () => {
    // The service never emits such an item; if one ever appeared, it is not a
    // reception and must not be classified as one.
    expect(classifyItem(receptionItem({ receptionRequired: false }), me)).not.toBe("to_receive");
  });

  it("the step is owned by the Transit queue, and unrelated roles cannot see it", () => {
    expect(queueForStep("coordinator_reception")).toBe("transit");
    expect(queueStepKeys("transit")).toContain("coordinator_reception");
    expect(visibleQueues(["CHIEF_OF_TRANSIT"], ["process:read"]).map((q) => q.key)).toContain("transit");
    for (const role of ["COURIER", "CASHIER", "CLIENT_USER"]) {
      expect(visibleQueues([role], ["process:read"]).map((q) => q.key), role).not.toContain("transit");
    }
  });

  it("/departments/queue and /my-work now read the SAME fact", () => {
    // The department queue keys on the open handoff…
    const deptQueue = read("../lib/workflow/access/queue.ts");
    expect(deptQueue).toContain("handoff");
    // …and so, now, does the process queue that feeds /my-work.
    expect(unionSlice()).toContain('.eq("status", "SENT")');
    // Reception authority is NOT what changed: it stays on the server.
    const engine = read("../lib/process/engine/actions.ts");
    expect(engine).toContain('guard("process:handoff:receive"');
  });
});

/**
 * Operations→Transit reception ownership (RATIFIED 2026-08-23).
 * ---------------------------------------------------------------------------
 * Effitrans ratified TRANSIT as the receiving department, Chef de Transit as the
 * primary receiver. Step 4 `coordinator_reception` declared
 * department:"coordination" / role:COORDINATOR while every other part of the
 * platform already treated it as Transit's reception — `receiveDossierAtTransit`
 * acts on that exact step key, the lifecycle map files it under « Réception
 * Transit » and T1, and the intake vocabulary calls the state HANDED_TO_TRANSIT.
 *
 * Because queues are derived from `department`, that ONE field sent the dossier
 * to the Coordination queue, so `/my-work` showed « À réceptionner (0) » to the
 * very role meant to receive it while `/departments/queue` (a different
 * subsystem, keyed on canonical departments) showed it under Transit. These
 * cases pin the corrected ownership and the agreement between the two surfaces.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { getStep } from "@/lib/process/effitrans-process";
import { queueForStep, queueStepKeys, visibleQueues } from "@/lib/process/queues/registry";
import { classifyItem, buildWorkbench, actionableCount, type WorkbenchItem } from "@/lib/navigation/workbench";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const RECEPTION_STEP = "coordinator_reception";

/** A queue item shaped like a dossier awaiting departmental reception. */
function pendingReception(over: Partial<WorkbenchItem> = {}): WorkbenchItem {
  return {
    stepKey: RECEPTION_STEP,
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

describe("Transit reception ownership — registry", () => {
  it("the reception step belongs to TRANSIT and to the Chef de Transit", () => {
    const step = getStep(RECEPTION_STEP)!;
    expect(step).toBeTruthy();
    expect(step.department).toBe("transit");
    expect(step.role).toBe("CHIEF_TRANSIT");
    expect(step.permissions).toContain("process:handoff:receive");
    // The label must name the receiver the operator actually is.
    expect(step.labelFr).toContain("Chef de Transit");
    expect(step.labelFr).not.toContain("Coordinateur");
  });

  it("the handoff still targets that step — one transition, retargeted by OWNERSHIP not by key", () => {
    const intake = read("../lib/process/engine/intake-actions.ts");
    expect(intake).toContain(`sendHandoff(fileId, "am_dossier_opening", "${RECEPTION_STEP}")`);
    // The Transit reception action acts on the same key — it always did.
    const transit = read("../lib/process/engine/transit-actions.ts");
    expect(transit).toContain(`.eq("to_step_key", "${RECEPTION_STEP}")`);
    // The step key is NOT renamed: live execution rows reference it.
    expect(getStep(RECEPTION_STEP)).toBeTruthy();
  });

  it("does not strand the next step or empty the Coordination queue", () => {
    // Step 5 still follows reception, so the chain is unbroken.
    expect(getStep("transit_declarant_assignment")!.prerequisites).toContain(RECEPTION_STEP);
    expect(getStep(RECEPTION_STEP)!.nextSteps).toContain("transit_declarant_assignment");
    // Coordination keeps its own work — this moved one step, not a department.
    const coordination = queueStepKeys("coordination");
    expect(coordination.length).toBeGreaterThan(0);
    expect(coordination).not.toContain(RECEPTION_STEP);
  });
});

describe("Transit reception ownership — projections agree", () => {
  it("the reception step is routed to the TRANSIT queue", () => {
    expect(queueForStep(RECEPTION_STEP)).toBe("transit");
    expect(queueStepKeys("transit")).toContain(RECEPTION_STEP);
  });

  it("a Chef de Transit sees the Transit queue; unrelated roles do not", () => {
    const perms = ["process:read"];
    const transitKeys = visibleQueues(["CHIEF_OF_TRANSIT"], perms).map((q) => q.key);
    expect(transitKeys).toContain("transit");
    for (const role of ["COURIER", "CASHIER", "HR_OFFICER", "CLIENT_USER"]) {
      expect(visibleQueues([role], perms).map((q) => q.key), role).not.toContain("transit");
    }
    // process:read is still required — a role alone grants no queue.
    expect(visibleQueues(["CHIEF_OF_TRANSIT"], [])).toEqual([]);
  });

  it("a pending reception lands in « À réceptionner » and counts as actionable", () => {
    const me = "chef-transit-user";
    expect(classifyItem(pendingReception(), me)).toBe("to_receive");

    const tabs = buildWorkbench([pendingReception()], me);
    const toReceive = tabs.find((t) => t.key === "to_receive")!;
    expect(toReceive.label).toBe("À réceptionner");
    expect(toReceive.items).toHaveLength(1);
    expect(actionableCount(tabs)).toBe(1);
    // …and it appears in exactly ONE tab — the partition is what makes counts honest.
    expect(tabs.filter((t) => t.items.length > 0).map((t) => t.key)).toEqual(["to_receive"]);
  });

  it("after reception it LEAVES « À réceptionner »", () => {
    const me = "chef-transit-user";
    const received = pendingReception({ received: true });
    expect(classifyItem(received, me)).not.toBe("to_receive");
    const tabs = buildWorkbench([received], me);
    expect(tabs.find((t) => t.key === "to_receive")!.items).toHaveLength(0);
  });

  it("a dossier already named to someone else is not put on a stranger's bench", () => {
    // Reception visibility must not become "everyone sees everything".
    expect(classifyItem(pendingReception({ assigneeId: "someone-else" }), "me")).toBeNull();
  });
});

describe("Transit reception ownership — authority is unchanged", () => {
  it("reception authority stays server-enforced, separate from visibility", () => {
    const transit = read("../lib/process/engine/transit-actions.ts");
    expect(transit).toContain("process:handoff:receive");
    // The engine's receive path re-guards regardless of what any surface showed.
    const engine = read("../lib/process/engine/actions.ts");
    expect(engine).toContain('guard("process:handoff:receive"');
  });

  it("client ownership (Responsable client) is untouched by the reception change", () => {
    const step = getStep(RECEPTION_STEP)!;
    // A departmental reception step carries no commercial-ownership semantics.
    expect(JSON.stringify(step)).not.toContain("account_manager");
    expect(JSON.stringify(step)).not.toContain("commercial_owner");
    const intake = read("../lib/process/engine/intake-actions.ts");
    const slice = intake.slice(intake.indexOf("export async function handDossierToTransit"));
    expect(slice).not.toContain("account_manager_id");
  });
});

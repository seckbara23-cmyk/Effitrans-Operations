/**
 * C-1 — STATIC REACHABILITY over the whole official process.
 * ---------------------------------------------------------------------------
 * The audit's reachability trace found step 14 `transport_assignment` with no
 * opening path at all: its prerequisite is step 3, but no step names it in
 * `nextSteps`, it is not an entry step, and no handoff targets it. Promotion by
 * `nextSteps` therefore left it PENDING forever, and since `pickup` requires
 * BOTH the customs and transport legs, steps 15-26 were unreachable.
 *
 * That trace is now a TEST. It runs over the registry, so a future step added
 * with a prerequisite nobody promotes — or a `nextSteps` list quietly relied
 * upon — fails here instead of in an operator's dossier.
 */
import { describe, it, expect } from "vitest";
import { EFFITRANS_PROCESS, PARALLEL_ACTIVITIES } from "@/lib/process/effitrans-process";
import { dependentsOf, isEntryStep, getNode } from "@/lib/process/engine/state";
import { CONTROL_OWNING_STEP } from "@/lib/process/control-gate";

/** Steps a handoff can open (the engine's `receiveHandoff` promotes its target). */
const HANDOFF_TARGETS = [
  "coordinator_reception",
  "coordinator_to_declarant",
  "administration_deposit_prep",
  "collections",
];

const ALL = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES];

describe("C-1 — every step has a legitimate opening path", () => {
  it("the registry still has 26 official steps", () => {
    expect(EFFITRANS_PROCESS).toHaveLength(26);
  });

  it.each(EFFITRANS_PROCESS.map((s) => [s.stepNumber, s.key] as const))(
    "step %s (%s) is openable",
    (_n, key) => {
      const entry = isEntryStep(key);
      const handoff = HANDOFF_TARGETS.includes(key);
      // ORIGIN: zero prerequisites, so nothing gates it and nothing needs to
      // promote it — `cotation` is handled by the opening action itself, either
      // SKIPPED with a derived reason (« Sans devis », QO-1) or completed
      // through the commercial conversion path.
      const origin = getNode(key)!.prerequisites.length === 0;
      // The C-1 rule: SOMETHING it declares as a prerequisite, when completed,
      // promotes it — i.e. it appears in that prerequisite's dependents.
      const node = getNode(key)!;
      const promotedByPrereq = node.prerequisites.some((p) => dependentsOf(p).includes(key));
      const openable = entry || handoff || origin || promotedByPrereq;
      expect(
        openable,
        `${key} has NO opening path: entry=${entry} handoff=${handoff} origin=${origin} promotedByPrereq=${promotedByPrereq}`,
      ).toBe(true);
    },
  );

  it("step 14 — the defect that motivated C-1 — is reachable from step 3", () => {
    expect(getNode("transport_assignment")!.prerequisites).toContain("am_dossier_opening");
    expect(dependentsOf("am_dossier_opening")).toContain("transport_assignment");
    // …and the narrative list does NOT name it, which is exactly why `nextSteps`
    // could never have opened it.
    expect(getNode("am_dossier_opening")!.nextSteps).not.toContain("transport_assignment");
  });

  it("the pickup convergence needs BOTH branches, and both are reachable", () => {
    const pickup = getNode("pickup")!;
    expect(pickup.prerequisites).toEqual(
      expect.arrayContaining(["customs_field_clearance", "transport_assignment"]),
    );
    for (const leg of pickup.prerequisites) {
      expect(dependentsOf(leg), `${leg} must promote pickup`).toContain("pickup");
    }
  });

  it("no step depends on `nextSteps` to become reachable", () => {
    // For every step, its openability must survive ignoring `nextSteps` entirely.
    for (const s of EFFITRANS_PROCESS) {
      if (isEntryStep(s.key) || HANDOFF_TARGETS.includes(s.key) || s.prerequisites.length === 0) continue;
      const viaPrereq = s.prerequisites.some((p) => dependentsOf(p).includes(s.key));
      expect(viaPrereq, `${s.key} would rely on nextSteps`).toBe(true);
    }
  });

  it("dependentsOf is the inverse of prerequisites, exactly", () => {
    for (const node of ALL) {
      for (const p of node.prerequisites) {
        expect(dependentsOf(p), `${p} -> ${node.key}`).toContain(node.key);
      }
    }
    // …and invents nothing: every dependent really declares that prerequisite.
    for (const node of ALL) {
      for (const dep of dependentsOf(node.key)) {
        expect(getNode(dep)!.prerequisites).toContain(node.key);
      }
    }
  });

  it("every gated control points at a step that is itself reachable", () => {
    for (const [control, stepKey] of Object.entries(CONTROL_OWNING_STEP)) {
      const node = getNode(stepKey)!;
      const openable =
        isEntryStep(stepKey) ||
        HANDOFF_TARGETS.includes(stepKey) ||
        node.prerequisites.length === 0 ||
        node.prerequisites.some((p) => dependentsOf(p).includes(stepKey));
      expect(openable, `${control} -> ${stepKey} unreachable`).toBe(true);
    }
  });
});

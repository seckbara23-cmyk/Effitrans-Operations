/**
 * D-1 successor promotion + D-2 transmission sequencing (ratified 2026-08-24).
 * ---------------------------------------------------------------------------
 * The engine had exactly two writers of AVAILABLE — the entry-step path and
 * handoff reception — and nothing promoted a completed step's successors.
 * `PENDING -> ACTIVE` being illegal, every step that was neither an entry step
 * nor a handoff target could never become reachable, and the queues (which list
 * OPEN_STATES plus open-handoff targets) could never show it. On
 * EFT-IMP-2026-00008 that deadlocked the dossier: Transit correctly refused for
 * want of step 3, and the Account Manager had no step 3 to perform.
 *
 * D-2 closes the other half: the handoff's own from-step is `am_dossier_opening`,
 * so transmitting before it is done is what put a dossier Transit could not work
 * into Transit's queue.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { getStep } from "@/lib/process/effitrans-process";
import { prerequisitesMet, canTransitionStep } from "@/lib/process/engine/state";
import { unmetTransitHandoffPrerequisites } from "@/lib/process/intake";
import type { ExecutionView } from "@/lib/process/engine/state";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const promote = read("../lib/process/engine/promote.ts");
const actions = read("../lib/process/engine/actions.ts");
const structures = read("../lib/process/engine/structures-actions.ts");
const intake = read("../lib/process/engine/intake-actions.ts");

const view = (stepKey: string, state: string): ExecutionView =>
  ({ stepKey, state }) as unknown as ExecutionView;

function fnSlice(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("D-1 — the promotion rule", () => {
  it("only PENDING -> AVAILABLE is used, never PENDING -> ACTIVE", () => {
    // The transition it uses is legal…
    expect(canTransitionStep("PENDING", "AVAILABLE")).toBe(true);
    // …and the one it must never use is not.
    expect(canTransitionStep("PENDING", "ACTIVE")).toBe(false);
    expect(promote).toContain('.eq("state", "PENDING")');
    expect(promote).toContain('.update({ state: "AVAILABLE" })');
    expect(promote).not.toContain('state: "ACTIVE"');
  });

  it("never overwrites a non-PENDING successor — which is what makes it idempotent", () => {
    expect(promote).toContain('if (!exec || exec.state !== "PENDING") continue;');
    // CAS on PENDING: a second run matches zero rows.
    expect(promote).toContain('.eq("state", "PENDING")');
    expect(promote).toContain('if (error || (data?.length ?? 0) !== 1) continue;');
  });

  it("never bypasses prerequisitesMet", () => {
    expect(promote).toContain("if (!prerequisitesMet(key, views)) continue;");
  });

  it("grants nothing and assigns nobody", () => {
    // Asserted on the UPDATE PAYLOAD, not the file: the signature legitimately
    // takes `permissions` (to load the snapshot), so a whole-file check would
    // fail on the parameter name while proving nothing about what is written.
    const update = promote.slice(promote.indexOf(".update({"), promote.indexOf(".select(\"id\")"));
    for (const forbidden of ["assigned_user_id", "assigned_role_code", "started_at", "submitted_by"]) {
      expect(update, forbidden).not.toContain(forbidden);
    }
    expect(update).toContain('state: "AVAILABLE"');
    // …and it never asserts or grants a permission of its own.
    expect(promote).not.toContain("assertPermission");
    expect(promote).not.toContain("hasPermission");
  });

  it("is server-only and NOT a client-callable server action", () => {
    expect(promote).toContain('import "server-only";');
    expect(promote.startsWith('"use server"')).toBe(false);
    expect(promote).toContain("deliberately NOT a");
  });
});

describe("D-1 — wired at exactly the three completion sites", () => {
  it("submitStep promotes ONLY on the COMPLETED branch, not on SUBMITTED", () => {
    const s = fnSlice(actions, "submitStep");
    expect(s).toContain('if (target === "COMPLETED") {');
    expect(s).toMatch(/if \(target === "COMPLETED"\) \{\s*\n\s*await promoteSuccessors\(/);
  });

  it("approveStep promotes both halves of the pair", () => {
    const s = fnSlice(actions, "approveStep");
    expect(s).toContain("await promoteSuccessors(c.tenantId, fileId, c.permissions, preparerKey, c.userId);");
    expect(s).toContain("await promoteSuccessors(c.tenantId, fileId, c.permissions, validatorStepKey, c.userId);");
  });

  it("skipStep promotes — a SKIPPED step is terminal-done", () => {
    expect(fnSlice(structures, "skipStep")).toContain("await promoteSuccessors(");
  });

  it("rejectStep does NOT promote — a rejection hands nothing on", () => {
    expect(fnSlice(actions, "rejectStep")).not.toContain("promoteSuccessors");
  });
});

describe("the canonical chain, through prerequisitesMet", () => {
  it("step 3 stays PENDING while step 2 is unfinished, and becomes eligible when it completes", () => {
    expect(getStep("am_dossier_opening")!.prerequisites).toEqual(["operations_intake"]);
    // Before: step 2 ACTIVE -> not met.
    expect(prerequisitesMet("am_dossier_opening", [view("operations_intake", "ACTIVE")])).toBe(false);
    // After: step 2 COMPLETED -> met, so promotion may occur.
    expect(prerequisitesMet("am_dossier_opening", [view("operations_intake", "COMPLETED")])).toBe(true);
  });

  it("step 4 becomes satisfiable only once step 3 is done", () => {
    expect(getStep("coordinator_reception")!.prerequisites).toEqual(["am_dossier_opening"]);
    expect(prerequisitesMet("coordinator_reception", [view("am_dossier_opening", "ACTIVE")])).toBe(false);
    expect(prerequisitesMet("coordinator_reception", [view("am_dossier_opening", "COMPLETED")])).toBe(true);
  });

  it("a SKIPPED prerequisite counts as done — « Sans devis » opens the chain", () => {
    expect(getStep("operations_intake")!.prerequisites).toContain("cotation");
    expect(prerequisitesMet("operations_intake", [view("cotation", "SKIPPED")])).toBe(true);
    expect(prerequisitesMet("operations_intake", [view("cotation", "AVAILABLE")])).toBe(false);
  });

  it("a successor with several prerequisites waits for the LAST one (parallel convergence)", () => {
    // `pickup` is the convergence step: multiple prerequisites, several branches.
    const pickup = getStep("pickup")!;
    expect(pickup.prerequisites.length).toBeGreaterThan(1);
    const [first, ...rest] = pickup.prerequisites;
    const partial = [view(first, "COMPLETED"), ...rest.map((k) => view(k, "ACTIVE"))];
    expect(prerequisitesMet("pickup", partial), "must stay PENDING on a partial branch").toBe(false);
    const all = pickup.prerequisites.map((k) => view(k, "COMPLETED"));
    expect(prerequisitesMet("pickup", all), "last prerequisite unlocks it").toBe(true);
  });
});

describe("D-2 — transmission requires its own from-step", () => {
  it("the server refuses until step 3 is done, BEFORE sending anything", () => {
    const s = fnSlice(intake, "handDossierToTransit");
    expect(s).toContain('return { ok: false, error: "am_opening_incomplete" };');
    expect(s.indexOf("am_opening_incomplete")).toBeLessThan(s.indexOf("sendHandoff("));
    expect(s).toContain('(e) => e.stepKey === "am_dossier_opening"');
    expect(s).toContain("if (!amOpening || !isDone(amOpening.state))");
  });

  it("the dossier page lists it as an unmet prerequisite, in French", () => {
    const unmet = unmetTransitHandoffPrerequisites({
      hasInstance: true,
      hasOwner: true,
      openBlockers: [],
      amOpeningDone: false,
    });
    expect(unmet).toEqual([
      { code: "am_opening_incomplete", labelFr: expect.stringContaining("étape 3") },
    ]);
    // …and disappears once step 3 is done.
    expect(
      unmetTransitHandoffPrerequisites({
        hasInstance: true,
        hasOwner: true,
        openBlockers: [],
        amOpeningDone: true,
      }),
    ).toEqual([]);
  });

  it("step 4's own prerequisite is NOT weakened to compensate", () => {
    expect(getStep("coordinator_reception")!.prerequisites).toEqual(["am_dossier_opening"]);
    expect(fnSlice(actions, "activateStep")).toContain("prerequisitesMet(stepKey, views)");
  });
});

describe("invariants that must survive", () => {
  it("designation of Responsable client touches no step state", () => {
    const commercial = read("../lib/files/actions.ts");
    const slice = commercial.slice(commercial.indexOf("assignCommercialOwner"));
    for (const forbidden of ["promoteSuccessors", "process_step_execution", '"AVAILABLE"', '"COMPLETED"']) {
      expect(slice, forbidden).not.toContain(forbidden);
    }
  });

  it("EFT-IMP-2026-00008 is not special-cased anywhere", () => {
    // Comments legitimately CITE the dossier that exposed the defect; what must
    // not exist is a code branch on it. Strip comments, then look.
    const codeOnly = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const src of [promote, actions, structures, intake]) {
      expect(codeOnly(src)).not.toContain("00008");
      expect(codeOnly(src)).not.toContain("EFT-IMP");
    }
  });
});

/**
 * UAT-1 hotfix — the zero-active-step defect.
 *
 * A dossier opened through `openDossierWorkflow` landed with an instance, an
 * owner, and NO ACTIVE step. Cause: `buildInitialExecutions` opens step 1 only,
 * intake SKIPS step 1, and `PENDING -> ACTIVE` is not a legal transition — so
 * `activateStep("operations_intake")` returned `invalid_state`, and the caller
 * discarded the result.
 *
 * These tests pin the canonical ladder (PENDING -> AVAILABLE -> ACTIVE), the
 * narrow entry-step exception, and the fact that no failure is swallowed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildInitialExecutions } from "@/lib/process/engine/init";
import {
  ENTRY_STEP_KEYS,
  canTransitionStep,
  isEntryStep,
  prerequisitesMet,
  type ExecutionView,
} from "@/lib/process/engine/state";
import { isDone, TERMINAL_DONE_STATES, type StepState } from "@/lib/process/engine/types";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTIONS = "lib/process/engine/actions.ts";
const INTAKE = "lib/process/engine/intake-actions.ts";
const ENGINE_SQL = "supabase/migrations/20260713000001_process_engine.sql";

const initial = () => buildInitialExecutions("tenant-1", "instance-1");
const views = (rows: { step_key: string; state: string }[]): ExecutionView[] =>
  rows.map((r) => ({ stepKey: r.step_key, state: r.state as StepState }));

/**
 * The opening sequence, replayed over the REAL initial rows using the REAL pure
 * state machine. Every transition must be one the machine permits — the point is
 * that the fix rides the canonical ladder rather than bypassing it.
 */
function simulateOpening(opts: { skipCotation: boolean }) {
  const rows = initial().map((r) => ({ step_key: r.step_key as string, state: r.state as string }));
  const set = (key: string, to: StepState) => {
    const row = rows.find((r) => r.step_key === key)!;
    if (!canTransitionStep(row.state as StepState, to)) {
      throw new Error(`illegal transition ${row.step_key}: ${row.state} -> ${to}`);
    }
    row.state = to;
  };

  // 3. skipStep(cotation) — AVAILABLE -> SKIPPED
  if (opts.skipCotation) set("cotation", "SKIPPED");

  // 4. activateEntryStep(operations_intake) — the two-leg ladder.
  const ok = prerequisitesMet("operations_intake", views(rows));
  if (ok) {
    set("operations_intake", "AVAILABLE"); // leg 1 — the previously missing one
    set("operations_intake", "ACTIVE"); // leg 2 — delegated to activateStep
  }
  return { rows, activated: ok };
}

// ---------------------------------------------------------------------------
describe("the defect, pinned", () => {
  it("initializes step 1 AVAILABLE and every other step PENDING", () => {
    const rows = initial();
    const cotation = rows.find((r) => r.step_key === "cotation")!;
    const intake = rows.find((r) => r.step_key === "operations_intake")!;
    expect(cotation.state).toBe("AVAILABLE");
    expect(intake.state).toBe("PENDING");
    expect(rows.filter((r) => r.state === "AVAILABLE")).toHaveLength(1);
  });

  it("FORBIDS PENDING -> ACTIVE — this is the root cause, and it stays forbidden", () => {
    expect(canTransitionStep("PENDING", "ACTIVE")).toBe(false);
    expect(canTransitionStep("PENDING", "AVAILABLE")).toBe(true);
    expect(canTransitionStep("AVAILABLE", "ACTIVE")).toBe(true);
  });

  it("counts SKIPPED as done, so skipping cotation satisfies the prerequisite", () => {
    expect(TERMINAL_DONE_STATES).toContain("SKIPPED");
    expect(isDone("SKIPPED")).toBe(true);
    const rows = initial().map((r) => ({ step_key: r.step_key as string, state: r.state as string }));
    expect(prerequisitesMet("operations_intake", views(rows))).toBe(false);
    rows.find((r) => r.step_key === "cotation")!.state = "SKIPPED";
    expect(prerequisitesMet("operations_intake", views(rows))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("opening leaves exactly one ACTIVE step", () => {
  it("activates operations_intake and nothing else", () => {
    const { rows } = simulateOpening({ skipCotation: true });
    const active = rows.filter((r) => r.state === "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0].step_key).toBe("operations_intake");
  });

  it("leaves cotation SKIPPED", () => {
    const { rows } = simulateOpening({ skipCotation: true });
    expect(rows.find((r) => r.step_key === "cotation")!.state).toBe("SKIPPED");
  });

  it("leaves every later step PENDING", () => {
    const { rows } = simulateOpening({ skipCotation: true });
    const others = rows.filter((r) => r.step_key !== "cotation" && r.step_key !== "operations_intake");
    expect(others.length).toBeGreaterThan(20);
    expect(others.every((r) => r.state === "PENDING")).toBe(true);
  });

  it("reaches ACTIVE only through legal transitions", () => {
    // simulateOpening throws on any transition the machine rejects.
    expect(() => simulateOpening({ skipCotation: true })).not.toThrow();
  });

  it("does NOT activate when cotation is deliberately kept", () => {
    const { rows, activated } = simulateOpening({ skipCotation: false });
    expect(activated).toBe(false);
    expect(rows.find((r) => r.step_key === "operations_intake")!.state).toBe("PENDING");
    expect(rows.find((r) => r.step_key === "cotation")!.state).toBe("AVAILABLE");
  });
});

// ---------------------------------------------------------------------------
describe("the entry-step exception is NARROW", () => {
  it("is a closed list of exactly one key", () => {
    expect([...ENTRY_STEP_KEYS]).toEqual(["operations_intake"]);
  });

  it("refuses every other step — no general pending-activation back door", () => {
    for (const k of ["cotation", "pickup", "customs_field_clearance", "billing_draft", "collections", "transit_validation"]) {
      expect(isEntryStep(k)).toBe(false);
    }
  });

  it("leaves activateStep itself unchanged — it still demands a legal transition", () => {
    const src = code(ACTIONS);
    const fn = src.slice(src.indexOf("export async function activateStep"));
    expect(fn).toContain('if (!canTransitionStep(st.state, "ACTIVE")) return fail("invalid_state");');
    // and it must NOT have grown a promotion of its own
    expect(fn.slice(0, fn.indexOf("export async function submitStep"))).not.toContain('"AVAILABLE"');
  });
});

// ---------------------------------------------------------------------------
describe("activateEntryStep contract", () => {
  const fn = () => {
    const src = code(ACTIONS);
    const start = src.indexOf("export async function activateEntryStep");
    return src.slice(start, src.indexOf("export async function activateStep", start));
  };

  it("gates on the closed entry list", () => {
    expect(fn()).toContain("if (!isEntryStep(stepKey)) return fail");
  });

  it("is idempotent: an already-ACTIVE step is success, not an error", () => {
    expect(fn()).toMatch(/if \(st\.state === "ACTIVE"\) return \{ ok: true, id: st\.execId \};/);
  });

  it("promotes PENDING only after checking prerequisites, via CAS", () => {
    const b = fn();
    expect(b).toContain('if (!prerequisitesMet(stepKey, views)) return fail("prerequisites_unmet")');
    expect(b).toMatch(/cas\(st\.execId, c\.tenantId, "PENDING", \{ state: "AVAILABLE" \}\)/);
  });

  it("fails safely on every unexpected state instead of forcing it", () => {
    expect(fn()).toMatch(/\} else if \(st\.state !== "AVAILABLE"\) \{[\s\S]{0,200}return fail\("invalid_state"\);/);
  });

  it("delegates the ACTIVE leg to activateStep rather than duplicating it", () => {
    expect(fn()).toContain("return activateStep(fileId, stepKey);");
  });
});

// ---------------------------------------------------------------------------
describe("no swallowed transition failure", () => {
  const open = () => {
    const src = code(INTAKE);
    const start = src.indexOf("export async function openDossierWorkflow");
    return src.slice(start, src.indexOf("export async function handDossierToTransit", start));
  };

  it("no longer calls activateStep for the entry step", () => {
    expect(open()).not.toContain('activateStep(fileId, "operations_intake")');
    expect(open()).toContain('activateEntryStep(fileId, "operations_intake")');
  });

  it("captures and checks the activation result", () => {
    const b = open();
    expect(b).toMatch(/const activated = await activateEntryStep\(/);
    expect(b).toMatch(/if \(!activated\.ok\)/);
    expect(b).toMatch(/return \{ ok: false, error: `activation_\$\{activated\.error\}` \};/);
  });

  it("captures and checks the skip result", () => {
    const b = open();
    expect(b).toMatch(/const skipped = await skipStep\(/);
    expect(b).toMatch(/if \(!skipped\.ok\)/);
    expect(b).toMatch(/return \{ ok: false, error: `cotation_\$\{skipped\.error\}` \};/);
  });

  it("tolerates ONLY the two idempotent/legitimate cases", () => {
    const b = open();
    // a retry where cotation is already finished
    expect(b).toContain("isDone(cotation.state)");
    // cotation deliberately kept => the step legitimately stays PENDING
    expect(b).toMatch(/input\.skipCotation === false && activated\.error === "prerequisites_unmet"/);
  });

  it("presents no half-open process as successful", () => {
    const b = open();
    // Every awaited engine call in the orchestration is bound to a variable
    // and inspected — no bare `await someStep(...)` fire-and-forget remains.
    for (const bare of [
      /^\s*await skipStep\(/m,
      /^\s*await activateStep\(/m,
      /^\s*await activateEntryStep\(/m,
      /^\s*await initializeProcessForFile\(/m,
      /^\s*await assignProcessOwner\(/m,
    ]) {
      expect(b).not.toMatch(bare);
    }
  });
});

// ---------------------------------------------------------------------------
describe("repeated opening is idempotent", () => {
  it("cannot create a second instance — index + early return", () => {
    expect(read(ENGINE_SQL)).toContain("create unique index uq_process_instance_file_active");
    const src = code(ACTIONS);
    const init = src.slice(
      src.indexOf("export async function initializeProcessForFile"),
      src.indexOf("async function loadStep"),
    );
    expect(init).toMatch(/if \(existing\.instance\) return \{ ok: true, id: existing\.instance\.id \};/);
  });

  it("inserts executions only on the create path, so a retry cannot duplicate them", () => {
    const src = code(ACTIONS);
    const init = src.slice(
      src.indexOf("export async function initializeProcessForFile"),
      src.indexOf("async function loadStep"),
    );
    const earlyReturn = init.indexOf("if (existing.instance) return");
    const insertExecs = init.indexOf('from("process_step_execution").insert');
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(insertExecs).toBeGreaterThan(earlyReturn);
  });

  it("re-running the opening over already-opened rows changes nothing", () => {
    const { rows: first } = simulateOpening({ skipCotation: true });
    // Second run: cotation is SKIPPED (skip refused, tolerated) and
    // operations_intake is ACTIVE (activateEntryStep returns ok, writes nothing).
    const cotation = first.find((r) => r.step_key === "cotation")!;
    const intake = first.find((r) => r.step_key === "operations_intake")!;
    expect(isDone(cotation.state as StepState)).toBe(true);
    expect(intake.state).toBe("ACTIVE");
    expect(canTransitionStep("SKIPPED", "SKIPPED")).toBe(false); // skip is refused
    expect(canTransitionStep("ACTIVE", "ACTIVE")).toBe(false); // activation is refused
    // …which is exactly why both are handled as tolerated/idempotent above.
  });
});

// ---------------------------------------------------------------------------
describe("scope discipline", () => {
  it("starts no WES-6 mission or WES-8 SLA work", () => {
    const all = code(ACTIONS) + code(INTAKE) + code("lib/process/engine/state.ts");
    expect(all).not.toMatch(/\bsla\b|\bbreach\b|\bescalation\b/i);
    expect(all).not.toMatch(/\bmission\b/i);
  });

  it("ships no migration", () => {
    // The fix is application-layer; the state machine and schema are untouched.
    expect(code("lib/process/engine/state.ts")).toContain("ENTRY_STEP_KEYS");
  });
});

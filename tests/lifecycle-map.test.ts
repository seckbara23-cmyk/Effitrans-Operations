/**
 * Phase 9.0B — lifecycle ↔ step-key validation registry (tests 39-44).
 * ---------------------------------------------------------------------------
 * The canonical 20-stage lifecycle and the Transit T1–T10 source workflow are
 * pinned onto the REAL 26-step registry keys, machine-validated: a registry
 * change that orphans a stage, or a mapping typo, fails here — before any
 * runtime ever sees it.
 */
import { describe, it, expect } from "vitest";
import {
  CANONICAL_LIFECYCLE,
  TRANSIT_SOURCE_MAP,
  CLOSURE_REQUIRED_STEP_KEYS,
  MODE_CONDITIONAL_STEP_KEYS,
  validateLifecycleMap,
} from "@/lib/process/lifecycle-map";
import { ALL_NODE_KEYS } from "@/lib/process/engine/state";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { STEP_APPLICABILITY } from "@/lib/process/applicability";

describe("39/41 — every canonical stage maps to existing step keys, no unknown keys anywhere", () => {
  it("the full validation passes with zero problems", () => {
    expect(validateLifecycleMap()).toEqual([]);
  });

  it("there are exactly 20 canonical stages, numbered 1..20", () => {
    expect(CANONICAL_LIFECYCLE).toHaveLength(20);
    expect(CANONICAL_LIFECYCLE.map((s) => s.stage)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("every referenced step key exists in the registry (and coverage is total — no orphan steps)", () => {
    const known = new Set(ALL_NODE_KEYS);
    const referenced = new Set<string>();
    for (const s of CANONICAL_LIFECYCLE) {
      for (const k of [...s.stepKeys, ...(s.optionalStepKeys ?? [])]) {
        expect(known.has(k), `${s.key} -> ${k}`).toBe(true);
        referenced.add(k);
      }
    }
    for (const k of ALL_NODE_KEYS) expect(referenced.has(k), `orphan registry step: ${k}`).toBe(true);
  });
});

describe("40 — Transit T1–T10 mapping is complete, with source terminology preserved", () => {
  it("all ten Transit source steps are mapped", () => {
    expect(TRANSIT_SOURCE_MAP.map((t) => t.key)).toEqual(["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10"]);
  });

  it("each maps to real registry keys or an explicit mechanism (T3 = correction return)", () => {
    const known = new Set(ALL_NODE_KEYS);
    for (const t of TRANSIT_SOURCE_MAP) {
      for (const k of t.stepKeys) expect(known.has(k), `${t.key} -> ${k}`).toBe(true);
      if (t.stepKeys.length === 0) expect(t.mechanism, t.key).toBeDefined();
    }
    expect(TRANSIT_SOURCE_MAP.find((t) => t.key === "T3")!.mechanism).toBe("correction_return");
  });

  it("preserves the source vocabulary (GAINDE, ORBUS/GRED, BAE, cotation, rattachement, Maritime/AIBD)", () => {
    const labels = TRANSIT_SOURCE_MAP.map((t) => t.labelFr).join(" ");
    for (const term of ["cotation", "ORBUS / GRED", "GAINDE", "rattachement", "BAE", "Maritime / AIBD"]) {
      expect(labels, term).toContain(term);
    }
  });
});

describe("42 — customer-stage mapping is total for the activated definition", () => {
  it("every registry step declares clientStage explicitly (a stage, or null = internal-only)", () => {
    for (const step of EFFITRANS_PROCESS) {
      expect(Object.prototype.hasOwnProperty.call(step, "clientStage"), step.key).toBe(true);
    }
  });
});

describe("43 — closure-required steps are explicit", () => {
  it("closure requires every registry node (the evaluator's rule, declared as a contract)", () => {
    expect([...CLOSURE_REQUIRED_STEP_KEYS].sort()).toEqual([...ALL_NODE_KEYS].sort());
  });
});

describe("44 — mode-specific steps are declared, from ONE source", () => {
  it("MODE_CONDITIONAL_STEP_KEYS is exactly the applicability registry's key set", () => {
    expect([...MODE_CONDITIONAL_STEP_KEYS].sort()).toEqual(Object.keys(STEP_APPLICABILITY).sort());
  });

  it("the customs-leg-only lifecycle stages reference only mode-conditional or shared keys coherently", () => {
    const conditional = new Set(MODE_CONDITIONAL_STEP_KEYS);
    for (const stage of CANONICAL_LIFECYCLE.filter((s) => s.customsLegOnly)) {
      // A customs-leg-only stage must be built from customs-conditional steps —
      // otherwise skipping the leg would orphan required work.
      for (const k of stage.stepKeys) expect(conditional.has(k), `${stage.key} -> ${k}`).toBe(true);
    }
  });
});

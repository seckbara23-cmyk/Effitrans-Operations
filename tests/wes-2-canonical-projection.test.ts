/**
 * Phase WES-2 — canonical projection, lifecycle ratchet, single progress formula.
 * ---------------------------------------------------------------------------
 * The projection is PURE, so the guarantees are tested as BEHAVIOUR: build it and
 * assert the outcome. Source assertions are used only to prove the NEGATIVE —
 * that no consumer computes progress of its own any more.
 *
 * The three properties WES-2 exists to establish:
 *   RATCHET   a dossier's stage never moves backwards (ADR-WES-010)
 *   ONE       exactly one progress formula, in one place
 *   PURE      the projection summarises facts — no SLA, routing, ownership,
 *             document policy, or tasks
 */
import { canonicalWorkflowInput, type CanonicalWorkflowInput } from "@/lib/workflow/canonical-input";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CANONICAL_STAGES,
  ladderIsWellFormed,
  stageForDepartment,
  stageOrdinal,
  type CanonicalStageKey,
} from "@/lib/workflow/stages";
import { buildCanonicalProjection } from "@/lib/workflow/projection";
import type { LifecycleInput } from "@/lib/files/lifecycle";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
/** Executable code only — prose must never satisfy or break an assertion. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PROJECTION = read("../lib/workflow/projection.ts");
const LIFECYCLE = read("../lib/files/lifecycle.ts");
const PORTAL_MAP = read("../lib/portal/progress-map.ts");
const JOURNEY_PANEL = read("../components/process/process-journey.tsx");
const TRACKER = read("../components/files/lifecycle-tracker.tsx");
const DRIVER = read("../lib/driver/service.ts");

/** A dossier at any point of the ladder. Everything defaults to "not started". */
function mk(over: Partial<LifecycleInput> = {}): CanonicalWorkflowInput {
  return canonicalWorkflowInput({
    fileId: "f1",
    file: { status: "OPENED", type: "IMP" },
    documents: [],
    missingRequired: [],
    customs: null,
    transport: null,
    invoices: [],
    podApproved: false,
    ...over,
  });
}

const APPROVED_DOC = { status: "APPROVED" };
const stageOf = (i: CanonicalWorkflowInput) => buildCanonicalProjection(i).currentStage;
const pct = (i: CanonicalWorkflowInput) => buildCanonicalProjection(i).progressPercent;

// ============================ A. The ladder (1-5) ===========================

describe("the canonical stage ladder", () => {
  it("1 — is the ratified order: draft → open → documentation → douane → transport → finance → archivage", () => {
    expect(CANONICAL_STAGES.map((s) => s.key)).toEqual([
      "draft",
      "open",
      "documentation",
      "customs",
      "transport",
      "finance",
      "archive",
    ]);
  });

  it("2 — is totally ordered with no gaps", () => {
    expect(ladderIsWellFormed()).toBe(true);
    const ordinals = CANONICAL_STAGES.map((s) => s.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });

  it("3 — reuses the existing Department vocabulary, inventing no second set", () => {
    const depts = new Set(CANONICAL_STAGES.map((s) => s.department));
    expect([...depts].sort()).toEqual(
      ["archive", "customs", "documentation", "finance", "opening", "transport"].sort(),
    );
  });

  it("4 — a department maps to the stage it ENTERS at", () => {
    expect(stageForDepartment("opening").key).toBe("draft");
    expect(stageForDepartment("customs").key).toBe("customs");
    expect(stageForDepartment("finance").key).toBe("finance");
  });

  it("5 — stageOrdinal is monotone along the ladder", () => {
    expect(stageOrdinal("draft")).toBeLessThan(stageOrdinal("documentation"));
    expect(stageOrdinal("documentation")).toBeLessThan(stageOrdinal("transport"));
    expect(stageOrdinal("transport")).toBeLessThan(stageOrdinal("archive"));
  });
});

// ====================== B. RATCHET PROOF (6-17) =============================

describe("RATCHET — a dossier can only move forward", () => {
  it("6 — THE UAT DEFECT: a newly-required document cannot send a dossier back to douane", () => {
    // Dossier in transport with a driver assigned. A POD document type becomes
    // required and is not yet approved, so the raw frontier falls back to
    // documentation — which is how the UI announced « Préparer et déclarer en
    // douane » on a dossier already being driven.
    const regressed = mk({
      documents: [APPROVED_DOC],
      missingRequired: [{ label: "Bon de livraison" }],
      customs: { status: "RELEASED", required: true },
      transport: { status: "DRIVER_ASSIGNED" },
    });
    const p = buildCanonicalProjection(regressed);

    expect(p.currentStage).toBe("transport"); // held, not regressed
    expect(p.ratchet.held).toBe(true);
    expect(p.ratchet.frontierStage).toBe("documentation");
    // …and the earlier work surfaces as a BLOCKER OVERLAY, per ADR-WES-010.
    expect(p.blocked).toBe(true);
    expect(p.responsibleDepartment).toBe("documentation");
  });

  it("7 — the ADR-WES-010 rendering is fully available from one object", () => {
    const p = buildCanonicalProjection(
      mk({
        documents: [APPROVED_DOC],
        missingRequired: [{ label: "Facture commerciale" }],
        customs: { status: "RELEASED", required: true },
        transport: { status: "IN_TRANSIT" },
      }),
    );
    // Stage: Transport · Statut: Bloqué · Responsable: Documentation
    expect(p.currentStage).toBe("transport");
    expect(p.blocked).toBe(true);
    expect(p.responsibleDepartment).toBe("documentation");
    expect(p.nextAction).not.toBeNull();
  });

  it("8 — a BLOCKED customs record does not regress the stage", () => {
    // You cannot be blocked in a department you never entered.
    expect(stageOf(mk({ documents: [APPROVED_DOC], customs: { status: "BLOCKED", required: true } }))).toBe("customs");
  });

  it("9 — a BLOCKED transport record does not regress the stage", () => {
    const p = buildCanonicalProjection(
      mk({
        documents: [APPROVED_DOC],
        customs: { status: "RELEASED", required: true },
        transport: { status: "BLOCKED" },
      }),
    );
    expect(stageOrdinal(p.currentStage)).toBeGreaterThanOrEqual(stageOrdinal("transport"));
  });

  it("10 — the stage never decreases across a forward walk of the whole lifecycle", () => {
    const walk: CanonicalWorkflowInput[] = [
      mk({ file: { status: "DRAFT", type: "IMP" } }),
      mk({}),
      mk({ documents: [APPROVED_DOC] }),
      mk({ documents: [APPROVED_DOC], customs: { status: "DECLARED", required: true } }),
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true } }),
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "PLANNED" } }),
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "IN_TRANSIT" } }),
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "POD_RECEIVED" }, podApproved: true }),
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "POD_RECEIVED" }, podApproved: true, invoices: [{ status: "ISSUED", balance: 10 }] }),
      mk({ file: { status: "CLOSED", type: "IMP" }, documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "POD_RECEIVED" }, podApproved: true, invoices: [{ status: "PAID", balance: 0 }] }),
    ];
    const ordinals = walk.map((i) => stageOrdinal(stageOf(i)));
    for (let k = 1; k < ordinals.length; k++) {
      expect(ordinals[k], `step ${k}`).toBeGreaterThanOrEqual(ordinals[k - 1]);
    }
  });

  it("11 — progress never decreases across that same walk", () => {
    const inputs = [
      mk({ file: { status: "DRAFT", type: "IMP" } }),
      mk({ documents: [APPROVED_DOC] }),
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true } }),
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "IN_TRANSIT" } }),
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "POD_RECEIVED" }, podApproved: true, invoices: [{ status: "ISSUED", balance: 5 }] }),
    ];
    const values = inputs.map(pct);
    for (let k = 1; k < values.length; k++) {
      expect(values[k], `step ${k}`).toBeGreaterThanOrEqual(values[k - 1]);
    }
  });

  it("12 — COMPLETED STAGES ARE IMMUTABLE: a later regression cannot reopen one", () => {
    const advanced = mk({
      documents: [APPROVED_DOC],
      customs: { status: "RELEASED", required: true },
      transport: { status: "IN_TRANSIT" },
    });
    const regressed = { ...advanced, missingRequired: [{ label: "Facture commerciale" }] };

    const before = buildCanonicalProjection(advanced).completedStages;
    const after = buildCanonicalProjection(regressed).completedStages;
    for (const stage of before) expect(after, stage).toContain(stage);
  });

  it("13 — the ratchet floor is exposed, so a surface can explain itself", () => {
    const p = buildCanonicalProjection(
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "PLANNED" } }),
    );
    expect(p.ratchet.reachedStage).toBe("transport");
    expect(typeof p.ratchet.held).toBe("boolean");
  });

  it("14 — a draft dossier is at the draft stage with nothing completed", () => {
    const p = buildCanonicalProjection(mk({ file: { status: "DRAFT", type: "IMP" } }));
    expect(p.currentStage).toBe("draft");
    expect(p.completedStages).toEqual([]);
    expect(p.progressPercent).toBe(0);
  });

  it("15 — leaving DRAFT advances the ratchet even with no other evidence", () => {
    expect(stageOrdinal(stageOf(mk({})))).toBeGreaterThanOrEqual(stageOrdinal("open"));
  });

  it("16 — a closed dossier reaches archive", () => {
    const p = buildCanonicalProjection(
      mk({
        file: { status: "CLOSED", type: "IMP" },
        documents: [APPROVED_DOC],
        customs: { status: "RELEASED", required: true },
        transport: { status: "POD_RECEIVED" },
        podApproved: true,
        invoices: [{ status: "PAID", balance: 0 }],
      }),
    );
    expect(p.currentStage).toBe("archive");
    expect(p.progressPercent).toBe(100);
  });

  it("17 — a cancelled customs leg is SKIPPED, never a regression", () => {
    const p = buildCanonicalProjection(
      mk({ file: { status: "OPENED", type: "TRP" }, documents: [APPROVED_DOC], transport: { status: "PLANNED" } }),
    );
    const customs = p.stages.find((s) => s.key === "customs")!;
    expect(customs.state).toBe("skipped");
    // …and a skipped stage is excluded from the denominator, never counted as late.
    expect(p.completedStages).not.toContain("customs");
    expect(p.pendingStages).not.toContain("customs");
  });
});

// ==================== C. ONE PROGRESS FORMULA (18-25) =======================

describe("PROGRESS — exactly one formula, in exactly one place", () => {
  it("18 — is completed applicable stages ÷ applicable stages", () => {
    const p = buildCanonicalProjection(
      mk({ documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "PLANNED" } }),
    );
    const applicable = p.stages.filter((s) => s.state !== "skipped");
    expect(p.progressPercent).toBe(Math.round((p.completedStages.length / applicable.length) * 100));
  });

  it("19 — a skipped stage leaves the denominator (a road dossier is not penalised)", () => {
    const road = buildCanonicalProjection(
      mk({ file: { status: "OPENED", type: "TRP" }, documents: [APPROVED_DOC], transport: { status: "PLANNED" } }),
    );
    expect(road.stages.filter((s) => s.state !== "skipped").length).toBe(CANONICAL_STAGES.length - 1);
  });

  it("20 — BLOCKED NEVER SUBTRACTS", () => {
    const clean = mk({
      documents: [APPROVED_DOC],
      customs: { status: "RELEASED", required: true },
      transport: { status: "IN_TRANSIT" },
    });
    const blocked = { ...clean, missingRequired: [{ label: "Facture commerciale" }] };
    expect(pct(blocked)).toBeGreaterThanOrEqual(pct(clean));
  });

  it("21 — is always a whole percentage in [0, 100]", () => {
    for (const input of [
      mk({ file: { status: "DRAFT", type: "IMP" } }),
      mk({ documents: [APPROVED_DOC] }),
      mk({ file: { status: "CLOSED", type: "IMP" }, documents: [APPROVED_DOC], customs: { status: "RELEASED", required: true }, transport: { status: "POD_RECEIVED" }, podApproved: true, invoices: [{ status: "PAID", balance: 0 }] }),
    ]) {
      const v = pct(input);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("22 — the 15-step tracker no longer computes a percentage", () => {
    expect(LIFECYCLE).not.toContain("completedPercent");
    expect(code(LIFECYCLE)).not.toMatch(/\* 100\)/);
  });

  it("23 — the portal timeline no longer computes a percentage", () => {
    expect(PORTAL_MAP).not.toMatch(/percent: Math\.round/);
    expect(code(PORTAL_MAP)).not.toMatch(/\/ stages\.length\) \* 100/);
  });

  it("24 — no UI component computes a percentage of its own", () => {
    for (const [name, src] of [["journey panel", JOURNEY_PANEL], ["lifecycle tracker", TRACKER]] as const) {
      expect(code(src), name).not.toMatch(/Math\.round\([^)]*\* 100\)/);
    }
    expect(TRACKER).toContain("projection.progressPercent");
  });

  it("25 — the chauffeur's number is MISSION EXECUTION, not dossier progress", () => {
    expect(DRIVER).toContain("executionPercent");
    expect(code(DRIVER)).not.toMatch(/dossier.*progress/i);
  });

  it("26 — `* 100` appears in exactly ONE workflow module: the projection", () => {
    expect(code(PROJECTION).match(/\* 100\)/g) ?? []).toHaveLength(1);
  });
});

// ================= D. SINGLE SOURCE: current stage / dept / next action =====

describe("ONE ANSWER — stage, department and next action", () => {
  const p = buildCanonicalProjection(
    mk({ documents: [APPROVED_DOC], customs: { status: "DECLARED", required: true } }),
  );

  it("27 — every question has exactly one answer on one object", () => {
    expect(p.currentStage).toBeTruthy();
    expect(p.currentDepartment).toBeTruthy();
    expect(p).toHaveProperty("nextAction");
    expect(Array.isArray(p.completedStages)).toBe(true);
    expect(Array.isArray(p.pendingStages)).toBe(true);
    expect(typeof p.progressPercent).toBe("number");
  });

  it("28 — completed and pending stages are disjoint and cover the applicable ladder", () => {
    const applicable = p.stages.filter((s) => s.state !== "skipped").map((s) => s.key);
    const accounted = new Set<CanonicalStageKey>([...p.completedStages, ...p.pendingStages]);
    for (const k of p.completedStages) expect(p.pendingStages).not.toContain(k);
    // the current/blocked stage is the only applicable one in neither bucket
    expect(applicable.filter((k) => !accounted.has(k)).length).toBeLessThanOrEqual(1);
  });

  it("29 — the current department is the stage's department, not task existence", () => {
    const stage = p.stages.find((s) => s.key === p.currentStage)!;
    expect(p.currentDepartment).toBe(stage.department);
  });

  it("30 — next action comes from the projection, never hardcoded in it", () => {
    expect(code(PROJECTION)).not.toMatch(/nextAction\s*=\s*"/);
    expect(code(PROJECTION)).toContain("nextAction: lifecycle.nextAction");
  });
});

// ================== E. PURITY + scope discipline (31-38) ====================

describe("PURITY — the projection summarises facts and nothing else", () => {
  it("31 — is deterministic: same input, same output", () => {
    const input = mk({ documents: [APPROVED_DOC], customs: { status: "DECLARED", required: true } });
    expect(buildCanonicalProjection(input)).toEqual(buildCanonicalProjection(input));
  });

  it("32 — performs NO I/O", () => {
    expect(PROJECTION).not.toMatch(/supabase|getAdminSupabaseClient|await |async |fetch\(/);
    expect(PROJECTION).not.toContain('"server-only"');
  });

  it("33 — TASKS DO NOT DETERMINE WORKFLOW: the projection takes no task input", () => {
    expect(code(PROJECTION)).not.toMatch(/\btask\b/i);
    const inputKeys = Object.keys(mk({}));
    expect(inputKeys).not.toContain("tasks");
  });

  it("34 — contains NO SLA, routing, ownership or document policy", () => {
    const src = code(PROJECTION);
    expect(src).not.toMatch(/sla|escalat|assignee|owner|permission|role/i);
  });

  it("35 — introduces no policy registry, event ledger or assignment engine (WES-3+)", () => {
    const src = code(PROJECTION) + code(read("../lib/workflow/stages.ts"));
    expect(src).not.toMatch(/policy_version|business_event|assignment_event|mission/i);
  });

  it("36 — adds no database table, column or migration", () => {
    const src = PROJECTION + read("../lib/workflow/stages.ts");
    expect(src).not.toMatch(/create table|alter table|\.from\(|\.insert\(|\.update\(/);
  });

  it("37 — reuses the existing rank tables and step derivation, duplicating neither", () => {
    expect(PROJECTION).toContain("getDossierLifecycle");
    expect(PROJECTION).toContain("CUSTOMS_RANK");
    expect(PROJECTION).toContain("TRANSPORT_RANK");
    expect(code(PROJECTION)).not.toMatch(/DOCUMENTS_PENDING:\s*1/); // no second rank table
  });

  it("38 — every consumer reads the projection rather than deriving progress", () => {
    for (const consumer of [
      "../app/files/[id]/page.tsx",
      "../lib/copilot/context.ts",
      "../lib/portal/shipments.ts",
      "../lib/portal/tracking.ts",
    ]) {
      expect(read(consumer), consumer).toContain("buildCanonicalProjection");
    }
  });
});

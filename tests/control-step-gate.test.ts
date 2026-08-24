/**
 * Control-level step gating (ratified 2026-08-24).
 * ---------------------------------------------------------------------------
 * Ratified rule: every dossier control requires BOTH the appropriate permission
 * AND the correct current official step / state / assignment. Out-of-sequence
 * acts are HARD-BLOCKED, not warned. Coverage for absence, if Effitrans ever
 * wants it, is an explicit audited override — never implicit inheritance.
 *
 * The defect this closes executed in production: a Chef de Transit created the
 * customs dossier (official step 6, owned by the Déclarant) on EFT-IMP-2026-00007
 * while step 4 was still current, because the control asked only for
 * `customs:create` and never for whose turn it was.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { ROLE_MAPPINGS } from "@/lib/process/roles";
import {
  CONTROL_OWNING_STEP,
  evaluateControlGate,
  controlGateError,
  CONTROL_GATE_MESSAGE_FR,
} from "@/lib/process/control-gate";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const customs = read("../lib/customs/actions.ts");
const finance = read("../lib/finance/actions.ts");
const server = read("../lib/process/control-gate-server.ts");

const ME = "user-me";
const OTHER = "user-other";
const step = (state: string, assignedUserId: string | null = null) =>
  ({ state, assignedUserId }) as never;

describe("the ratified rule — pure decision core", () => {
  it("ALLOWS an open, unclaimed owning step", () => {
    for (const state of ["AVAILABLE", "ACTIVE", "BLOCKED", "SUBMITTED"]) {
      expect(
        evaluateControlGate({ hasInstance: true, step: step(state), userId: ME }),
        state,
      ).toEqual({ allowed: true, reason: "step_open" });
    }
  });

  it("HARD-BLOCKS a step that has not been reached — the 00007 case", () => {
    // No execution row for the owning step: the workflow never got there.
    const r = evaluateControlGate({ hasInstance: true, step: null, userId: ME });
    expect(r).toEqual({ allowed: false, reason: "step_not_started" });
    expect(controlGateError(r.reason)).toBe("step_gate_step_not_started");
  });

  it("HARD-BLOCKS a closed or not-yet-open step", () => {
    for (const state of ["PENDING", "COMPLETED", "SKIPPED", "REJECTED", "CANCELLED"]) {
      expect(
        evaluateControlGate({ hasInstance: true, step: step(state), userId: ME }),
        state,
      ).toEqual({ allowed: false, reason: "step_closed" });
    }
  });

  it("HARD-BLOCKS a step claimed by somebody else, and allows its own assignee", () => {
    expect(evaluateControlGate({ hasInstance: true, step: step("ACTIVE", OTHER), userId: ME }))
      .toEqual({ allowed: false, reason: "assigned_to_another" });
    expect(evaluateControlGate({ hasInstance: true, step: step("ACTIVE", ME), userId: ME }))
      .toEqual({ allowed: true, reason: "step_open" });
  });

  it("is a BLOCK, never a warning — no refusal maps to a pass", () => {
    for (const reason of ["step_not_started", "step_closed", "assigned_to_another"] as const) {
      expect(controlGateError(reason)).toMatch(/^step_gate_/);
      expect(CONTROL_GATE_MESSAGE_FR[reason].length).toBeGreaterThan(10);
      // The refusal never names the other person.
      expect(CONTROL_GATE_MESSAGE_FR[reason]).not.toMatch(/@|user-/);
    }
  });

  it("defers to permission ONLY when the dossier has no process instance", () => {
    expect(evaluateControlGate({ hasInstance: false, step: null, userId: ME }))
      .toEqual({ allowed: true, reason: "no_process_instance" });
    // …and that is the ONLY pass-through: with an instance, absence blocks.
    expect(evaluateControlGate({ hasInstance: true, step: null, userId: ME }).allowed).toBe(false);
  });
});

describe("every gated control maps to a real official step", () => {
  it("names only step keys the registry defines", () => {
    const keys = new Set(EFFITRANS_PROCESS.map((s) => s.key));
    for (const [control, stepKey] of Object.entries(CONTROL_OWNING_STEP)) {
      expect(keys.has(stepKey), `${control} -> ${stepKey}`).toBe(true);
    }
  });

  it("routes each Déclarant-owned customs control to a Déclarant step", () => {
    const owner = (stepKey: string) => {
      const s = EFFITRANS_PROCESS.find((x) => x.key === stepKey)!;
      return ROLE_MAPPINGS.find((r) => r.officialRole === s.role)?.tenantRole ?? s.role;
    };
    // The act that actually happened on 00007.
    expect(CONTROL_OWNING_STEP["customs.create"]).toBe("customs_preparation");
    expect(owner("customs_preparation")).toBe("CUSTOMS_DECLARANT");
    // …and the others the audit listed.
    expect(owner(CONTROL_OWNING_STEP["customs.receivability"])).toBe("CUSTOMS_DECLARANT");
    expect(owner(CONTROL_OWNING_STEP["customs.attachment"])).toBe("CUSTOMS_DECLARANT");
    expect(owner(CONTROL_OWNING_STEP["customs.validation"])).toBe("CHIEF_OF_TRANSIT");
    expect(owner(CONTROL_OWNING_STEP["customs.release"])).toBe("CUSTOMS_FIELD_AGENT");
    expect(owner(CONTROL_OWNING_STEP["customs.gainde_registration"])).toBe("CUSTOMS_FINANCE_OFFICER");
    // Finance.
    expect(owner(CONTROL_OWNING_STEP["finance.invoice_create"])).toBe("BILLING_OFFICER");
    expect(owner(CONTROL_OWNING_STEP["finance.invoice_issue"])).toBe("BILLING_OFFICER");
  });
});

describe("the server enforces it, on every gated action", () => {
  it("all nine customs controls call the gate", () => {
    for (const ctrl of [
      "customs.create", "customs.update", "customs.status",
      "customs.receivability", "customs.attachment", "customs.gainde_registration",
      "customs.validation", "customs.bae", "customs.release",
    ]) {
      expect(customs, ctrl).toContain(`assertControlStep("${ctrl}"`);
    }
    expect((customs.match(/assertControlStep\(/g) ?? []).length).toBe(9);
  });

  it("the Finance panel's own controls call the gate", () => {
    expect(finance).toContain('assertControlStep("finance.invoice_create"');
    expect(finance).toContain('assertControlStep("finance.invoice_issue"');
  });

  it("the gate is a SECOND condition — the permission check is still there", () => {
    // Permission first, then the step. Neither replaces the other.
    for (const perm of ["customs:create", "customs:validate", "customs:release", "customs:register"]) {
      expect(customs, perm).toContain(`assertPermission("${perm}")`);
    }
    expect(finance).toContain('assertPermission("finance:create")');
    expect(finance).toContain('assertPermission("finance:issue")');
    // …and in createCustoms the permission precedes the gate.
    const slice = customs.slice(customs.indexOf("export async function createCustoms"));
    expect(slice.indexOf('assertPermission("customs:create")')).toBeLessThan(
      slice.indexOf("assertControlStep("),
    );
  });

  it("a refusal returns an error — it never falls through to the write", () => {
    expect(customs).toContain("if (gate) return { ok: false, error: gate };");
    expect(finance).toContain("if (g) return { ok: false, error: g };");
  });

  it("the server resolves the step itself and is tenant-scoped", () => {
    expect(server).toContain('scopedFrom(admin, "process_instance", tenantId)');
    expect(server).toContain('scopedFrom(admin, "process_step_execution", tenantId)');
    expect(server).toContain("evaluateControlGate(");
    // It does NOT re-check the permission: each action keeps its own.
    expect(server).not.toContain("assertPermission");
  });
});

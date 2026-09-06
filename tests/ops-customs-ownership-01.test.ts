/**
 * OPS-CUSTOMS-OWNERSHIP-01 — the customs panel becomes step-aware and role-correct.
 * ---------------------------------------------------------------------------
 * THE UAT DEFECT. On an IMP dossier the Chef de Transit assigned a Déclarant,
 * who prepared the declaration and moved the status through Déclaré → En revue →
 * Inspection. Attaching GAINDE/ORBUS then failed with « L'action a échoué.
 * Veuillez réessayer. », and switching to the Chef showed that SAME screen
 * offering the Chef the Déclarant's maker controls next to « Valider ».
 *
 * Three defects, one screen:
 *
 *   1. The attachment belongs to step 11 and the dossier was on step 6, so the
 *      server was right to refuse — but the control was offered anyway.
 *   2. `step_gate_*` had no French sentence anywhere. `CONTROL_GATE_MESSAGE_FR`
 *      existed from the start and was rendered NOWHERE, so a precise refusal
 *      reached the operator as a generic one.
 *   3. The step gate asks "is the step open" and "is it claimed by someone
 *      else" — never "is this work YOURS". On an open, UNASSIGNED step any
 *      permission holder could act, and customs permissions are broad by design.
 *
 * What is deliberately NOT changed: the 26-step graph, the customs statuses,
 * maker/checker, TRANSIT-CUSTODY-05, and `assertControlStep` itself.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateControlOwnership } from "@/lib/process/control-ownership";
import {
  CONTROL_OWNING_STEP,
  CONTROL_GATE_MESSAGE_FR,
  CONTROL_OWNERSHIP_ERROR,
  stepGateMessageFr,
} from "@/lib/process/control-gate";
import { CUSTOMS_STATUSES, nextStatuses } from "@/lib/customs/status";
import { EFFITRANS_PROCESS, getStep } from "@/lib/process/effitrans-process";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DECLARANT = "user-declarant";
const CHEF = "user-chef";
const ADMIN = "user-sysadmin";

/** The UAT shape: step 6 open, owned by the Déclarant. */
const base = {
  hasInstance: true,
  owningRole: "CUSTOMS_DECLARANT",
  stepAssignedUserId: null as string | null,
  userId: CHEF,
  actorRoles: ["CHIEF_OF_TRANSIT"] as readonly string[],
};

// ═══════════ the rule ══════════════════════════════════════════════════════

describe("OPS-CUSTOMS-OWNERSHIP-01 — an open, unassigned step belongs to its role", () => {
  it("01 — the owning role may act on an unassigned open step", () => {
    const r = evaluateControlOwnership({ ...base, userId: DECLARANT, actorRoles: ["CUSTOMS_DECLARANT"] });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("owning_role");
  });

  it("02 — THE DEFECT: another role holding the permission may NOT", () => {
    // Chef de Transit holds customs:update for their own acts, which is exactly
    // why permission alone could never have answered this.
    const r = evaluateControlOwnership(base);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("not_owning_role");
  });

  it("03 — an explicit assignment beats role membership", () => {
    // A Chef who was ASSIGNED the step owns that work; the assignment is
    // audited, which role membership is not.
    const r = evaluateControlOwnership({ ...base, stepAssignedUserId: CHEF });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("assigned_to_self");
  });

  it("04 — a step claimed by someone else is deferred, not double-refused", () => {
    // `assertControlStep` already returns `assigned_to_another`. Refusing here
    // too would give one situation two different sentences.
    const r = evaluateControlOwnership({ ...base, stepAssignedUserId: DECLARANT });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("assigned_to_other");
  });

  it("05 — no process instance defers, exactly as the step gate does", () => {
    const r = evaluateControlOwnership({ ...base, hasInstance: false });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("no_instance");
  });

  it("06 — a step with no owning role defers to permission", () => {
    const r = evaluateControlOwnership({ ...base, owningRole: null });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("unowned_step");
  });

  it("07 — holding several roles is enough if one of them owns the step", () => {
    const r = evaluateControlOwnership({
      ...base,
      actorRoles: ["CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT"],
    });
    expect(r.allowed).toBe(true);
  });
});

// ═══════════ SYSTEM_ADMIN — ratified: no implicit bypass ═══════════════════

describe("OPS-CUSTOMS-OWNERSHIP-01 — platform administration gets no implicit ownership", () => {
  it("08 — SYSTEM_ADMIN is REFUSED on an unassigned foreign-role step", () => {
    // Ratified 2026-09-06. SYSTEM_ADMIN owns no step, and inheriting ownership
    // from a broad permission set is precisely the implicit coverage the
    // 2026-08-24 ratification forbade.
    const r = evaluateControlOwnership({ ...base, userId: ADMIN, actorRoles: ["SYSTEM_ADMIN"] });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("not_owning_role");
  });

  it("09 — SYSTEM_ADMIN is ALLOWED once the step is audibly assigned to them", () => {
    // The escape hatch is the existing audited one: assign the step, then act.
    // It leaves a record of who took someone else's work and when.
    const r = evaluateControlOwnership({
      ...base,
      userId: ADMIN,
      actorRoles: ["SYSTEM_ADMIN"],
      stepAssignedUserId: ADMIN,
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("assigned_to_self");
  });

  it("10 — no role string is special-cased anywhere in the rule", () => {
    // A bypass would most likely arrive as a hardcoded role name. There is none.
    const src = code("lib/process/control-ownership.ts");
    for (const role of ["SYSTEM_ADMIN", "OPS_SUPERVISOR", "CHIEF_OF_TRANSIT", "isSystemAdmin"]) {
      expect(src, role).not.toContain(role);
    }
  });
});

// ═══════════ the UAT scenario, control by control ══════════════════════════

describe("OPS-CUSTOMS-OWNERSHIP-01 — the UAT dossier, replayed", () => {
  const owner = (control: string) => {
    const step = CONTROL_OWNING_STEP[control];
    return getStep(step)!.role;
  };
  const ask = (control: string, roles: string[], assigned: string | null = null) =>
    evaluateControlOwnership({
      hasInstance: true,
      owningRole: { CUSTOMS_DECLARANT: "CUSTOMS_DECLARANT", CHIEF_TRANSIT: "CHIEF_OF_TRANSIT",
                    CUSTOMS_FINANCE_OFFICER: "CUSTOMS_FINANCE_OFFICER",
                    CUSTOMS_FIELD_AGENT: "CUSTOMS_FIELD_AGENT",
                    COORDINATOR: "COORDINATOR" }[owner(control) as string] ?? null,
      actorRoles: roles,
      stepAssignedUserId: assigned,
      userId: CHEF,
    }).allowed;

  it("11 — the Chef cannot perform the Déclarant's preparation controls", () => {
    for (const control of ["customs.create", "customs.update", "customs.status", "customs.receivability"]) {
      expect(ask(control, ["CHIEF_OF_TRANSIT"]), control).toBe(false);
      expect(ask(control, ["CUSTOMS_DECLARANT"]), control).toBe(true);
    }
  });

  it("12 — the Chef cannot perform the GAINDE/ORBUS attachment; the Déclarant can", () => {
    expect(ask("customs.attachment", ["CHIEF_OF_TRANSIT"])).toBe(false);
    expect(ask("customs.attachment", ["CUSTOMS_DECLARANT"])).toBe(true);
  });

  it("13 — the Chef KEEPS the checker control at their own step", () => {
    expect(ask("customs.validation", ["CHIEF_OF_TRANSIT"])).toBe(true);
    expect(ask("customs.validation", ["CUSTOMS_DECLARANT"])).toBe(false);
  });

  it("14 — GAINDE registration stays with Customs Finance; the field release with the field agent", () => {
    expect(ask("customs.gainde_registration", ["CUSTOMS_FINANCE_OFFICER"])).toBe(true);
    expect(ask("customs.gainde_registration", ["CHIEF_OF_TRANSIT"])).toBe(false);
    expect(ask("customs.bae", ["CUSTOMS_FIELD_AGENT"])).toBe(true);
    expect(ask("customs.release", ["CHIEF_OF_TRANSIT"])).toBe(false);
  });
});

// ═══════════ the vocabulary that was never rendered ════════════════════════

describe("OPS-CUSTOMS-OWNERSHIP-01 — every refusal explains itself", () => {
  it("15 — each gate reason resolves to a French sentence", () => {
    for (const reason of ["step_not_started", "step_closed", "assigned_to_another", "not_owning_role"]) {
      const msg = stepGateMessageFr(`step_gate_${reason}`);
      expect(msg, reason).toBeTruthy();
      expect(msg!.length).toBeGreaterThan(10);
    }
  });

  it("16 — the ownership refusal names a ROLE, never a person", () => {
    const msg = CONTROL_GATE_MESSAGE_FR.not_owning_role;
    expect(msg).toBeTruthy();
    for (const leak of ["@", "user-", "Chef ", "Déclarant "]) expect(msg).not.toContain(leak);
  });

  it("17 — a non-gate code is left alone for the existing map", () => {
    expect(stepGateMessageFr("self_validation")).toBeNull();
    expect(stepGateMessageFr(null)).toBeNull();
    expect(stepGateMessageFr("")).toBeNull();
  });

  it("18 — the panel resolves gate codes instead of falling through to generic", () => {
    const panel = code("components/customs/customs-panel.tsx");
    expect(panel).toContain("stepGateMessageFr(res.error)");
    // The generic fallback survives for genuinely unknown codes — it is the
    // ordering that changed, not its existence.
    expect(panel).toContain("c.errors.generic");
  });
});

// ═══════════ the panel renders the server's verdict ════════════════════════

describe("OPS-CUSTOMS-OWNERSHIP-01 — the panel does not re-derive authority", () => {
  it("19 — every step-owned control group is scoped to its owner", () => {
    // Assert the RENDER CONDITION of each control group, not merely that the
    // control id appears somewhere: the same id also appears on its GateHint
    // line, so a loose match stays green while the buttons themselves lose
    // their owner scoping — which is exactly what a probe demonstrated.
    const panel = code("components/customs/customs-panel.tsx");
    const groups: [string, string][] = [
      ["customs.create", '{canCreate && owns("customs.create") && ('],
      ["customs.status", '{(canUpdate || canRelease) && owns("customs.status") && targets.length > 0 && ('],
      ["customs.gainde_registration", '{canRegisterGainde && owns("customs.gainde_registration") && ('],
      ["customs.attachment", '{canAttach && owns("customs.attachment") && ('],
      ["customs.validation", '{canValidate && owns("customs.validation") && !record.reviewedAt && ('],
    ];
    for (const [control, condition] of groups) {
      expect(panel, control).toContain(condition);
    }
  });

  it("20 — an owned but not-yet-open control is disabled WITH its reason", () => {
    const panel = code("components/customs/customs-panel.tsx");
    expect(panel).toContain('disabled={pending || !gateOpen("customs.attachment")}');
    expect(panel).toContain('gateReason("customs.attachment")');
    expect(panel).toContain('disabled={pending || !gateOpen("customs.validation")}');
  });

  it("21 — the verdict comes from the server, not from permissions", () => {
    const panel = code("components/customs/customs-panel.tsx");
    expect(panel).toMatch(/gates\[controlId\]\?\.isOwner/);
    expect(panel).toMatch(/gates\[controlId\]\?\.allowed/);
    const page = code("app/files/[id]/page.tsx");
    expect(page).toContain("getControlVerdicts(");
    expect(page).toContain("gates={customsControlVerdicts}");
  });

  it("22 — nothing is hidden client-side that the server would allow", () => {
    // `owns` defaults to TRUE when a control has no verdict, so a missing entry
    // shows the control and lets the server decide — never the reverse.
    const src = read("components/customs/customs-panel.tsx");
    expect(src).toContain("gates[controlId]?.isOwner ?? true");
    expect(src).toContain("gates[controlId]?.allowed ?? true");
  });
});

// ═══════════ enforcement is server-side ════════════════════════════════════

describe("OPS-CUSTOMS-OWNERSHIP-01 — the server enforces it, on every control", () => {
  it("23 — all nine customs controls pass through BOTH gates", () => {
    const actions = code("lib/customs/actions.ts");
    expect((actions.match(/customsControlGate\(/g) ?? []).length).toBe(10); // 9 sites + the definition
    expect(actions).not.toMatch(/const gate = await assertControlStep\(/);
    const helper = actions.slice(actions.indexOf("async function customsControlGate"));
    expect(helper).toContain("assertControlStep(");
    expect(helper).toContain("assertControlOwner(");
  });

  it("24 — ownership is asked only after the step gate allowed", () => {
    const actions = code("lib/customs/actions.ts");
    const helper = actions.slice(actions.indexOf("async function customsControlGate"));
    const body = helper.slice(0, helper.indexOf("}", helper.indexOf("return")));
    expect(body.indexOf("assertControlStep")).toBeLessThan(body.indexOf("assertControlOwner"));
    expect(body).toContain("??");
  });

  it("25 — assertControlStep itself is untouched", () => {
    // The 2026-08-24 ratification keeps its exact shape; this slice sits beside
    // it. Its signature and its four decision branches must be unchanged.
    const gate = read("lib/process/control-gate.ts");
    expect(gate).toContain("export function evaluateControlGate(input: ControlGateInput): ControlGateResult {");
    expect(gate).toContain('if (!input.hasInstance) return { allowed: true, reason: "no_process_instance" };');
    expect(gate).toContain('if (!input.step) return { allowed: false, reason: "step_not_started" };');
    const server = read("lib/process/control-gate-server.ts");
    expect(server).toContain("export async function assertControlStep(");
    expect(server).not.toContain("assertControlOwner");
  });
});

// ═══════════ what must NOT have moved ══════════════════════════════════════

describe("OPS-CUSTOMS-OWNERSHIP-01 — the ratified frame is untouched", () => {
  it("26 — the 26-step graph is unchanged", () => {
    expect(EFFITRANS_PROCESS).toHaveLength(26);
    expect(getStep("customs_preparation")!.prerequisites).toEqual(["transit_declarant_assignment"]);
    expect(getStep("gainde_document_submission")!.role).toBe("CUSTOMS_DECLARANT");
    expect(getStep("transit_validation")!.role).toBe("CHIEF_TRANSIT");
  });

  it("27 — the control→step map is unchanged", () => {
    expect(CONTROL_OWNING_STEP["customs.attachment"]).toBe("gainde_document_submission");
    expect(CONTROL_OWNING_STEP["customs.validation"]).toBe("transit_validation");
    expect(CONTROL_OWNING_STEP["customs.status"]).toBe("customs_preparation");
  });

  it("28 — customs statuses are unchanged", () => {
    expect(CUSTOMS_STATUSES).toHaveLength(10);
    expect(nextStatuses("DECLARED")).toEqual(["UNDER_REVIEW", "INSPECTION", "DUTIES_ASSESSED", "BLOCKED", "CANCELLED"]);
    expect(nextStatuses("RELEASED")).toEqual([]);
  });

  it("29 — maker/checker and TRANSIT-CUSTODY-05 are untouched", () => {
    const customs = code("lib/customs/actions.ts");
    expect(customs).toMatch(/release_approval_status\s*!==\s*"APPROVED"/);
    expect(customs).toContain('customsControlGate("customs.release"');
    // The database still refuses a preparer validating their own record; this
    // slice adds a condition in front of that, never in place of it.
    const validation = customs.slice(customs.indexOf("export async function recordCustomsValidation"));
    expect(validation.slice(0, 1500)).toContain("self_validation");
  });

  it("30 — no permission or grant was changed", () => {
    const templates = read("lib/platform/role-templates.ts");
    expect((templates.match(/"customs:validate"/g) ?? []).length).toBe(3);
    expect((templates.match(/"customs:register"/g) ?? []).length).toBe(3);
    const ownership = read("lib/process/control-ownership.ts") + read("lib/process/control-ownership-server.ts");
    expect(ownership).not.toContain("assertPermission");
    expect(ownership).not.toContain("role_permission");
  });

  it("31 — no migration was added", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = require("node:fs").readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    expect(files).toHaveLength(138);
    expect(files.at(-1)).toBe("20260930000001_customs_release_approval.sql");
  });
});

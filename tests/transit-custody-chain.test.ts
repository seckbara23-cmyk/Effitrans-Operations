/**
 * TRANSIT-CUSTODY-03 — the Transit chain, from custody to release.
 * ---------------------------------------------------------------------------
 * Ratified sequence for a customs-required dossier:
 *
 *   Operations transmits → Chef receives → Chef COMPLETES reception
 *     → Chef assigns the Déclarant
 *     → the ASSIGNED Déclarant executes
 *     → Chef validates the declaration
 *     → GAINDE / submission / follow-up
 *     → BAE recorded (field act, records only)
 *     → Chef VERIFIES and releases  → customs_record RELEASED
 *     → physical transport becomes eligible
 *
 * Four guards, all server-side:
 *   1. naming a Déclarant needs Transit custody AND the Chef's seat;
 *   2. dispatching a field team needs the same custody;
 *   3. assigned work belongs to its assignee;
 *   4. recording the BAE is not releasing — the Chef verifies.
 *      ⚠ BLOCKED and NOT implemented: `recordCustomsRelease` is bound by a
 *      ratified 2026-08-24 control (`assertControlStep("customs.release")`) to
 *      step 13's CLAIMANT — the field agent. Delivering guard 4 as ruled needs
 *      that control, the registry or the schema to change, so it is reported
 *      for ruling rather than forced. The block is pinned below.
 *
 * And four things that must NOT move: transport preparation stays parallel,
 * physical execution stays customs-gated, transport-only and waived dossiers
 * never wait for a release that does not apply, and no 27th step was invented.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mayAssignStep,
  transitCustodyRefusal,
  ASSIGNMENT_AUTHORITY,
  ASSIGNMENT_OWNED_STEPS,
} from "@/lib/process/handoff-routes";
import { canPickup } from "@/lib/transport/gates";
import { getStep } from "@/lib/process/effitrans-process";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { FACT_RULES } from "@/lib/process/reconcile/satisfaction";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NL = String.fromCharCode(10);

const transitActions = strip(read("lib/process/engine/transit-actions.ts"));
const engineActions = strip(read("lib/process/engine/actions.ts"));
const routes = strip(read("lib/process/handoff-routes.ts"));
const panel = strip(read("components/process/transit-panel.tsx"));
const processPage = strip(read("app/files/[id]/process/page.tsx"));

const perms = (r: string) =>
  TENANT_ROLE_TEMPLATES.find((t) => t.key === r)!.permissions as readonly string[];

const fn = (src: string, name: string) => {
  const i = src.indexOf(`export async function ${name}`);
  const rest = src.slice(i);
  const j = rest.indexOf(NL + "export ", 1);
  return j > 0 ? rest.slice(0, j) : rest;
};

const RECEIVED = [{ toStepKey: "coordinator_reception", status: "RECEIVED" }];
const SENT = [{ toStepKey: "coordinator_reception", status: "SENT" }];

// ═══════════ guard 1 — custody before naming a Déclarant ═══════════════════

describe("TRANSIT-CUSTODY-03 guard 1 — the Déclarant is named by Transit, once Transit holds the dossier", () => {
  it("before transmission → refused", () => {
    expect(transitCustodyRefusal({ handoffs: [], receptionState: "AVAILABLE" }))
      .toBe("transit_custody_required");
  });

  it("transmitted but not received → refused", () => {
    expect(transitCustodyRefusal({ handoffs: SENT, receptionState: "AVAILABLE" }))
      .toBe("transit_custody_required");
  });

  it("received but reception not COMPLETED → still refused", () => {
    for (const state of ["AVAILABLE", "ACTIVE", "PENDING", null]) {
      expect(transitCustodyRefusal({ handoffs: RECEIVED, receptionState: state }), String(state))
        .toBe("transit_custody_required");
    }
  });

  it("received AND reception completed → custody is held", () => {
    for (const state of ["COMPLETED", "APPROVED"]) {
      expect(transitCustodyRefusal({ handoffs: RECEIVED, receptionState: state }), state).toBeNull();
    }
  });

  it("only the Chef's seat may name a Déclarant — the STEP is narrowed, not the capability", () => {
    expect(mayAssignStep("transit_declarant_assignment", ["CHIEF_OF_TRANSIT"])).toBe(true);
    expect(mayAssignStep("transit_declarant_assignment", ["OPS_SUPERVISOR"])).toBe(true);
    expect(mayAssignStep("transit_declarant_assignment", ["SYSTEM_ADMIN"])).toBe(true);
    expect(mayAssignStep("transit_declarant_assignment", ["COORDINATOR"])).toBe(false);
    expect(mayAssignStep("transit_declarant_assignment", ["CUSTOMS_DECLARANT"])).toBe(false);
    expect(mayAssignStep("transit_declarant_assignment", ["ACCOUNT_MANAGER"])).toBe(false);
  });

  it("the Coordinator keeps `customs:assign` — step 12 is its documented responsibility", () => {
    expect(perms("COORDINATOR")).toContain("customs:assign");
    expect(getStep("customs_followup")!.permissions).toContain("customs:assign");
    // …and every other assignable step is unnarrowed.
    for (const key of ["customs_preparation", "customs_followup", "customs_field_clearance"]) {
      expect(mayAssignStep(key, ["COORDINATOR"]), key).toBe(true);
    }
    expect(Object.keys(ASSIGNMENT_AUTHORITY)).toEqual(["transit_declarant_assignment"]);
  });

  it("the server enforces both, in assignTransitStep", () => {
    const s = fn(transitActions, "assignTransitStep");
    expect(s).toContain('if (!mayAssignStep(stepKey, ctx.roles)) return fail("not_authorized_assigner")');
    expect(s).toContain("transitCustody(admin, ctx.tenantId, instance.id)");
    expect(s).toContain('transitGuard("customs:assign", fileId)');
  });
});

// ═══════════ guard 2 — dispatch is a Transit act ═══════════════════════════

describe("TRANSIT-CUSTODY-03 guard 2 — field dispatch waits for custody", () => {
  it("dispatchToField asks the same custody question", () => {
    const s = fn(transitActions, "dispatchToField");
    expect(s).toContain("transitCustody(guardAdmin, ctx.tenantId, inst.id)");
    expect(s).toContain('transitGuard("process:team:manage", fileId)');
  });

  it("it gates the DISPATCH only — transport preparation is untouched", () => {
    // Step 14 still opens from step 3, and nothing in the transport plane
    // consults Transit custody.
    expect(getStep("transport_assignment")!.prerequisites).toEqual(["am_dossier_opening"]);
    const transport = strip(read("lib/transport/actions.ts"));
    expect(transport).not.toContain("transitCustody");
    expect(transport).not.toContain("transitCustodyRefusal");
  });
});

// ═══════════ guard 3 — assigned work belongs to its assignee ═══════════════

describe("TRANSIT-CUSTODY-03 guard 3 — a Déclarant does not work another's dossier", () => {
  it("both execution doors ask it", () => {
    for (const name of ["activateStep", "submitStep"]) {
      expect(fn(engineActions, name), name).toContain("assignmentRefusal(");
    }
    expect(engineActions).toContain('return execution.assignedUserId === userId ? null : "step_assigned_to_other"');
  });

  it("it bites only where an assignee exists, and only on assignable steps", () => {
    const helper = engineActions.slice(engineActions.indexOf("function assignmentRefusal"));
    const body = helper.slice(0, helper.indexOf(NL + "}"));
    expect(body).toContain("if (!ASSIGNMENT_OWNED_STEPS.has(execution.stepKey)) return null;");
    expect(body).toContain("if (!execution.assignedUserId) return null;");
  });

  it("the owned set is exactly the steps Transit assigns", () => {
    expect([...ASSIGNMENT_OWNED_STEPS].sort()).toEqual([
      "customs_field_clearance", "customs_followup", "customs_preparation",
      "gainde_document_submission", "transit_declarant_assignment",
    ]);
    // A step nobody assigns keeps claim semantics, not assignment semantics.
    for (const key of ["am_dossier_opening", "coordinator_reception", "pickup", "billing_draft"]) {
      expect(ASSIGNMENT_OWNED_STEPS.has(key), key).toBe(false);
    }
  });

  it("reassignment stays possible and is audited with before and after", () => {
    const s = fn(transitActions, "assignTransitStep");
    expect(s).toContain("writeAudit");
    expect(s).toContain("before");
    expect(s).toContain("assigned_user_id");
  });
});

// ═══════════ guard 4 — BLOCKED, and why ═══════════════════════════════════

describe("TRANSIT-CUSTODY-03 guard 4 — recorded as blocked, not silently dropped", () => {
  it("the release is bound to step 13's CLAIMANT by a ratified control", () => {
    // `recordCustomsRelease` calls `assertControlStep("customs.release", …)`,
    // ratified 2026-08-24: permission is necessary, not sufficient — the owning
    // official step must be open and not claimed by somebody else. The owning
    // step is `customs_field_clearance`, which the field agent claims to do the
    // field work. So a Chef de Transit who did not claim it is refused, and
    // guard 4 as ruled ("only the Chef produces RELEASED") cannot be delivered
    // without changing that control, the registry, or the schema — none of which
    // this slice is authorised to do. Reported for ruling instead of forced.
    const customs = strip(read("lib/customs/actions.ts"));
    const fnRelease = fn(customs, "recordCustomsRelease");
    expect(fnRelease).toContain('assertControlStep("customs.release"');
    expect(fnRelease).toContain('assertPermission("customs:release")');
    const gate = strip(read("lib/process/control-gate.ts"));
    expect(gate + strip(read("lib/process/control-gate-server.ts"))).toContain("assignedUserId");
  });

  it("recording the BAE therefore still releases — unchanged, and pinned as such", () => {
    const s = fn(transitActions, "recordBae");
    expect(s).toContain("releaseCustoms(customs.id, baeReference.trim())");
    expect(transitActions).not.toContain("releaseTransitToTransport");
  });

  it("the field agent keeps `customs:release` — it is step 13's own permission", () => {
    // Narrowing that grant, the obvious first idea, would have blocked the field
    // agent from the very step the workflow assigns them.
    expect(getStep("customs_field_clearance")!.permissions).toEqual(["customs:release"]);
    expect(perms("CUSTOMS_FIELD_AGENT")).toContain("customs:release");
  });
});

// ═══════════ transport boundary — unchanged ════════════════════════════════

describe("TRANSIT-CUSTODY-03 — preparation stays parallel, execution stays gated", () => {
  it("physical pickup still waits for RELEASED on customs-required dossiers", () => {
    expect(canPickup("IMP", { required: true, status: "DECLARED" }, false)).toBe(false);
    expect(canPickup("IMP", { required: true, status: "RELEASED" }, false)).toBe(true);
  });

  it("the gate reads STATUS — an in-progress customs record never unlocks transport", () => {
    expect(canPickup("IMP", { required: true, status: "INSPECTION" }, false)).toBe(false);
    expect(FACT_RULES["customs_field_clearance"].satisfied({ customs: { status: "RELEASED" } } as never)).toBe(true);
    expect(FACT_RULES["customs_field_clearance"].satisfied({ customs: { status: "INSPECTION" } } as never)).toBe(false);
  });

  it("transport-only and waived dossiers never wait for a release", () => {
    for (const type of ["TRP", "HND"]) {
      expect(canPickup(type, null, false), type).toBe(true);
      expect(canPickup(type, { required: true, status: "DECLARED" }, false), type).toBe(true);
    }
    expect(canPickup("IMP", { required: false, status: "NOT_STARTED" }, false)).toBe(true);
  });

  it("the audited override is preserved", () => {
    expect(canPickup("IMP", { required: true, status: "DECLARED" }, true)).toBe(true);
  });

  it("the pickup gate itself is unchanged", () => {
    const gates = strip(read("lib/process/engine/gates.ts"));
    expect(gates).toContain("customs_released");
    expect(gates).toContain('checkEvidence("BORDEREAU_LIVRAISON", snap)');
  });
});

// ═══════════ the operator sequence, and nothing hidden ═════════════════════

describe("TRANSIT-CUSTODY-03 — the Chef's sequence reads coherently", () => {
  it("a refusal names the prerequisite instead of failing generically", () => {
    for (const code of ["transit_custody_required", "step_assigned_to_other", "not_authorized_assigner"]) {
      expect(panel, code).toContain(`${code}:`);
    }
  });

  it("every new refusal has French on the surfaces that can receive it", () => {
    for (const p of ["components/process/queue-row-actions.tsx", "components/process/step-actions.tsx"]) {
      const src = strip(read(p));
      for (const code of ["transit_custody_required", "step_assigned_to_other", "not_authorized_assigner"]) {
        expect(src, `${p} ${code}`).toContain(`${code}:`);
      }
    }
  });
});

// ═══════════ scope ═════════════════════════════════════════════════════════

describe("TRANSIT-CUSTODY-03 — scope held", () => {
  it("the canonical 26-step dependency graph is unchanged", () => {
    expect(getStep("coordinator_reception")!.prerequisites).toEqual(["am_dossier_opening"]);
    expect(getStep("transit_declarant_assignment")!.prerequisites).toEqual(["coordinator_reception"]);
    expect(getStep("customs_preparation")!.prerequisites).toEqual(["transit_declarant_assignment"]);
    expect(getStep("transport_assignment")!.prerequisites).toEqual(["am_dossier_opening"]);
  });

  it("no migration was added for this slice", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = require("node:fs").readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    expect(files.at(-1)).toBe("20260929000001_ops_supervisor_file_update.sql");
  });

  it("no RBAC grant was changed", () => {
    const templates = read("lib/platform/role-templates.ts");
    const seed = read("supabase/seed.sql");
    for (const src of [templates, seed]) {
      expect(src).toContain("customs:validate");
      expect(src).toContain("customs:release");
    }
    expect(perms("CUSTOMS_FIELD_AGENT")).toContain("customs:release");
  });

  it("the UAT dossier is named nowhere in the slice", () => {
    for (const src of [transitActions, engineActions, routes, panel, processPage]) {
      expect(src).not.toMatch(/EFT-IMP-2026-0001\d/);
    }
  });
});

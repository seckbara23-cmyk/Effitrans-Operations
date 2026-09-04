/**
 * A-1 / A-2 — step execution is authorized by the step's OWN permission.
 * ---------------------------------------------------------------------------
 * `activateStep` and `submitStep` hard-coded `process:manage`, held by only four
 * roles, so 17 of the 26 official steps could not be started or submitted by the
 * role the registry names as their owner — including the entire Finance lane, so
 * the governed billing path depended on nobody noticing. In every case the
 * owning role already held the step's declared permission; the engine never
 * asked. `approveStep` had always resolved it correctly; activate and submit
 * were the odd ones out.
 *
 * A-2 makes the surface honest: a button is offered only when the server would
 * accept it. That is advisory — every server action re-checks independently, and
 * a forged call is refused by the same guard regardless of what any UI rendered.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { ROLE_MAPPINGS } from "@/lib/process/roles";
import { stepPermission } from "@/lib/process/engine/state";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const engine = read("../lib/process/engine/actions.ts");
const state = read("../lib/process/engine/state.ts");
const service = read("../lib/process/queues/service.ts");
const row = read("../components/process/queue-row-actions.tsx");

/** Permissions a tenant role template grants, by role code. */
function permsOf(roleCode: string): readonly string[] {
  return TENANT_ROLE_TEMPLATES.find((r) => r.key === roleCode)?.permissions ?? [];
}
const tenantRoleFor = (officialRole: string) =>
  ROLE_MAPPINGS.find((r) => r.officialRole === officialRole)?.tenantRole ?? officialRole;

/** Only these hold `process:manage` — the blunt permission A-1 stops requiring. */
const PROCESS_MANAGE_ROLES = ["ACCOUNT_MANAGER", "COORDINATOR", "OPS_SUPERVISOR", "SYSTEM_ADMIN"];

/** The steps whose owning role lacks `process:manage` — the ones A-1 unblocks. */
const AFFECTED = EFFITRANS_PROCESS.filter(
  (s) => !PROCESS_MANAGE_ROLES.includes(tenantRoleFor(s.role)),
);

function fnSlice(name: string): string {
  const start = engine.indexOf(`export async function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = engine.indexOf("\nexport ", start + 1);
  return engine.slice(start, next === -1 ? engine.length : next);
}

describe("A-1 — the guard resolves from the registry", () => {
  it("activateStep and submitStep ask for the STEP's permission, not process:manage", () => {
    for (const fn of ["activateStep", "submitStep"]) {
      const s = fnSlice(fn);
      expect(s, fn).toContain("await guard(stepPermission(stepKey), fileId)");
      expect(s, fn).not.toContain('guard("process:manage"');
    }
    // …the same pattern approveStep always used.
    expect(fnSlice("approveStep")).toContain('getNode(validatorStepKey)?.permissions[0] ?? "process:manage"');
  });

  it("keeps process:manage as the fallback, and only as the fallback", () => {
    expect(state).toContain('return getNode(stepKey)?.permissions[0] ?? "process:manage";');
    // A node that declares no permission still resolves to the generic one.
    expect(stepPermission("__no_such_step__")).toBe("process:manage");
  });

  it("resolves each official step to its own declared permission", () => {
    for (const step of EFFITRANS_PROCESS) {
      expect(stepPermission(step.key), step.key).toBe(step.permissions[0] ?? "process:manage");
    }
  });

  it("process lifecycle operations keep the managerial guard", () => {
    // Creating/entering a process is a managerial act, not owner step execution.
    for (const fn of ["initializeProcessForFile", "activateEntryStep"]) {
      expect(fnSlice(fn), fn).toContain('guard("process:manage", fileId)');
    }
  });
});

describe("A-1 — parameterized over every affected step", () => {
  it("covers all 17 steps whose owner lacked process:manage", () => {
    expect(AFFECTED).toHaveLength(17);
    // The Finance lane must be inside this set: Tuesday's governed billing path
    // must not have depended on accidental process:manage.
    for (const key of [
      "billing_draft", "finance_invoice_validation", "billing_dispatch",
      "administration_deposit_prep", "courier_deposit",
      "administration_proof_handoff", "collections",
    ]) {
      expect(AFFECTED.map((s) => s.key), key).toContain(key);
    }
    // …as must Transit, customs and transport.
    for (const key of [
      "coordinator_reception", "transit_declarant_assignment", "transit_validation",
      "customs_preparation", "gainde_registration", "gainde_document_submission",
      "customs_field_clearance", "transport_assignment", "pickup",
    ]) {
      expect(AFFECTED.map((s) => s.key), key).toContain(key);
    }
  });

  it.each(AFFECTED.map((s) => [s.key, tenantRoleFor(s.role)] as const))(
    "%s — its owning role %s HOLDS the permission the guard now demands",
    (stepKey, owningRole) => {
      const required = stepPermission(stepKey);
      expect(required, `${stepKey} must declare its own permission`).not.toBe("process:manage");
      expect(permsOf(owningRole), `${owningRole} ⊅ ${required}`).toContain(required);
      // …and it does NOT hold the blunt one, which is why the old guard refused.
      expect(permsOf(owningRole)).not.toContain("process:manage");
    },
  );

  it("an unrelated role holds neither, so it is still refused", () => {
    for (const step of AFFECTED) {
      const required = stepPermission(step.key);
      // COURIER is unrelated to everything except its own step.
      if (tenantRoleFor(step.role) === "COURIER") continue;
      expect(permsOf("COURIER"), `${step.key}`).not.toContain(required);
    }
  });

  it("managerial roles are unaffected — process:manage still resolves for them", () => {
    for (const role of PROCESS_MANAGE_ROLES) {
      if (role === "SYSTEM_ADMIN") continue; // technical break-glass, granted separately
      expect(permsOf(role), role).toContain("process:manage");
    }
  });
});

describe("A-1 — every other guard is untouched", () => {
  it("state, prerequisites, gates, maker-checker and tenant checks all remain", () => {
    const act = fnSlice("activateStep");
    expect(act).toContain("prerequisitesMet(stepKey, views)");
    // C-4: still gated, now on PLATFORM state rather than the caller's view.
    // PICKUP_AGENT holds no customs:read, so the customs-release requirement
    // read false for the very role that owns the step.
    expect(act).toContain("authoritativePickupGate(c.tenantId, fileId)");
    const sub = fnSlice("submitStep");
    expect(sub).toContain("evaluateStepEvidence(stepKey");
    expect(sub).toContain("canTransitionStep(st.state, target)");
    expect(sub).toContain("requiresIndependentReview(stepKey)");
    // Maker-checker stays on IDENTITY in the approve path.
    expect(fnSlice("approveStep")).toContain("evaluateMakerChecker(st.submittedBy, c.userId");
    // Tenant + dossier visibility are enforced inside `guard` itself.
    expect(engine).toContain("isFileVisible(");
  });
});

describe("A-2 — the surface never offers what the server refuses", () => {
  it("the row ANDs queue availability with the caller's own capability", () => {
    // A-2's invariant is unchanged; its expression moved. `queue.actions` still
    // says what the QUEUE offers, and the caller's own capability still gates
    // it — but that capability now comes from the SHARED derivation the
    // dossier's official-process page also reads (UAT-WF-STEP3-001), so two
    // execution surfaces cannot hold two opinions about one server rule.
    expect(row).toContain('const offers = (a: string) => queue.actions.includes(a as never);');
    expect(row).toContain("const el = item.eligibility;");
    expect(row).toContain('offers("start") && el.canStart');
    expect(row).toContain('offers("submit") && el.canSubmit');
    expect(row).toContain("ADVISORY ONLY");
    // …and the row does not re-derive any of it locally.
    expect(row).not.toContain("item.callerMayAct");
    expect(row).not.toMatch(/item\.state === "(AVAILABLE|ACTIVE)"/);
  });

  it("capability is computed SERVER-side, from the same resolution the engine uses", () => {
    expect(service).toContain("requiredPermission: stepPermission(stepKey),");
    expect(service).toContain("callerMayAct: hasPermission(req.permissions, stepPermission(stepKey)),");
  });

  it("reception keeps its OWN authority — A-2 must not hide what the server allows", () => {
    // receiveHandoff is guarded by process:handoff:receive, not the step's perm.
    expect(service).toContain('callerMayReceive: hasPermission(req.permissions, "process:handoff:receive"),');
    expect(row).toContain("item.callerMayReceive");
    // The Réceptionner button must NOT be gated on the step permission.
    const receptionBlock = row.slice(row.indexOf("awaitingReception &&"), row.indexOf("Réceptionner") + 20);
    expect(receptionBlock).not.toContain("callerMayAct");
  });

  it("the UI is advisory: the server re-checks regardless of what was rendered", () => {
    // A forged call reaches the same guard — the button was never the boundary.
    for (const fn of ["activateStep", "submitStep"]) {
      expect(fnSlice(fn), fn).toContain("await guard(stepPermission(stepKey), fileId)");
    }
    // The queue wrappers add no authority of their own.
    const wrappers = read("../lib/process/queues/actions.ts");
    expect(wrappers).not.toContain("hasPermission");
    expect(wrappers).not.toContain("callerMayAct");
  });
});

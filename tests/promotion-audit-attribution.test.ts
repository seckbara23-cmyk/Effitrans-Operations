/**
 * F-α / F-β / F-γ — promotion attribution and audit-failure compensation.
 * ---------------------------------------------------------------------------
 * The first production execution of D-1 crashed the operator's request AFTER
 * every write committed: the promotion audit was written with `actorId: null`
 * and `validateAuditEvent` rightly refused an unattributed non-system action.
 * My 18 D-1 tests were text pins over the source; none EXECUTED the emitted
 * event against the real validator, so none could notice. These cases close
 * that class: the exact event shape runs through the actual validator.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { validateAuditEvent } from "@/lib/audit/validate";
import { AuditActions } from "@/lib/audit/events";
import { canTransitionStep } from "@/lib/process/engine/state";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const promote = read("../lib/process/engine/promote.ts");
const actions = read("../lib/process/engine/actions.ts");
const structures = read("../lib/process/engine/structures-actions.ts");

/** The EXACT event shape promote.ts emits — keep in lockstep with the source. */
function promotionEvent(actorId: string | null) {
  return {
    action: AuditActions.PROCESS_STEP_ACTIVATED,
    actorId: actorId as string,
    tenantId: "00000000-0000-0000-0000-000000000001",
    entity: "process_step_execution",
    entityId: "11111111-1111-1111-1111-111111111111",
    after: { step_key: "am_dossier_opening", state: "AVAILABLE", promoted_from: "operations_intake" },
  };
}

describe("F-γ — the emitted event runs through the REAL validator", () => {
  it("an attributed promotion event validates", () => {
    expect(() => validateAuditEvent(promotionEvent("22222222-2222-2222-2222-222222222222"))).not.toThrow();
  });

  it("actorId: null is refused — the exact production failure, now a unit test", () => {
    expect(() => validateAuditEvent(promotionEvent(null))).toThrow(/actorId/);
  });

  it("the source emits the same shape this test validates", () => {
    // Lockstep guard: if promote.ts changes its event, this file must follow.
    expect(promote).toContain("action: AuditActions.PROCESS_STEP_ACTIVATED");
    expect(promote).toContain('after: { step_key: key, state: "AVAILABLE", promoted_from: completedStepKey }');
    expect(promote).toMatch(/writeAudit\(\{\s*\n\s*action: AuditActions\.PROCESS_STEP_ACTIVATED,\s*\n\s*actorId,/);
    // …and never the null that crashed production. Asserted on CODE ONLY: the
    // header comment legitimately QUOTES the incident (`actorId: null`), and a
    // whole-file check fails on that prose while proving nothing.
    const codeOnly = promote.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("actorId: null");
  });
});

describe("F-α — the completing actor is the audit actor", () => {
  it("every caller passes its own authenticated identity", () => {
    expect(actions).toContain("promoteSuccessors(c.tenantId, fileId, c.permissions, stepKey, c.userId)");
    expect(actions).toContain("promoteSuccessors(c.tenantId, fileId, c.permissions, preparerKey, c.userId)");
    expect(actions).toContain("promoteSuccessors(c.tenantId, fileId, c.permissions, validatorStepKey, c.userId)");
    expect(structures).toContain("promoteSuccessors(ctx.tenantId, fileId, ctx.permissions, stepKey, ctx.userId)");
  });

  it("the parameter is non-nullable and no system identity is invented", () => {
    expect(promote).toContain("actorId: string,");
    expect(promote).not.toMatch(/actorId[?]?:\s*string\s*\|\s*null/);
    for (const fake of ["SYSTEM_ACTOR", "system-user", "00000000-0000-0000-0000-000000000000"]) {
      expect(promote, fake).not.toContain(fake);
    }
  });
});

describe("F-β — audit failure leaves no unaudited AVAILABLE successor behind", () => {
  it("compensation is a STRICT CAS: AVAILABLE, unassigned, unstarted — nothing else", () => {
    const comp = promote.slice(promote.indexOf("} catch (auditFailure)"), promote.indexOf("PromotionAuditUnrecoverableError(key"));
    expect(comp).toContain('.update({ state: "PENDING" })');
    expect(comp).toContain('.eq("state", "AVAILABLE")');
    expect(comp).toContain('.is("assigned_user_id", null)');
    expect(comp).toContain('.is("started_at", null)');
    // AVAILABLE -> PENDING is a legal transition — the revert is state-machine-clean.
    expect(canTransitionStep("AVAILABLE", "PENDING")).toBe(true);
  });

  it("a claimed or started successor is NEVER reverted — the hard error surfaces instead", () => {
    expect(promote).toContain("class PromotionAuditUnrecoverableError");
    expect(promote).toContain("throw new PromotionAuditUnrecoverableError(key, auditFailure)");
    // The condition is DOCUMENTED, verbatim, at the declaration site.
    expect(promote).toContain("DOCUMENTED HARD-ERROR CONDITION");
    expect(promote).toContain("Never overwrite later work");
  });

  it("the parent completion is never disturbed by promotion handling", () => {
    // Nothing in the catch path touches the completed step or its audit…
    const catchBlock = promote.slice(promote.indexOf("} catch (auditFailure)"));
    expect(catchBlock).not.toContain("completedStepKey");
    expect(catchBlock).not.toContain('"COMPLETED"');
    // …and submitStep completes-and-audits BEFORE promotion runs, so the
    // completion is a committed fact whatever happens afterwards.
    const s = actions.slice(actions.indexOf("export async function submitStep"));
    expect(s.indexOf("PROCESS_STEP_COMPLETED")).toBeLessThan(s.indexOf("promoteSuccessors"));
  });

  it("promotion itself still targets AVAILABLE, never ACTIVE", () => {
    expect(promote).toContain('.update({ state: "AVAILABLE" })');
    expect(promote).not.toContain('.update({ state: "ACTIVE" })');
  });

  it("atomic transaction is recorded as follow-up hardening, not silently omitted", () => {
    expect(promote).toContain("ATOMICITY FOLLOW-UP");
  });
});

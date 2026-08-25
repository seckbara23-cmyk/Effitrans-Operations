/**
 * C-4 — the irreversible-send boundary, pinned in source.
 * ---------------------------------------------------------------------------
 * RATIFIED INVARIANT:
 *
 *   An irreversible external action must not execute unless its required
 *   workflow consequence is capable of landing, and a failure of that
 *   consequence after the external action must never be reported as ordinary
 *   success.
 *
 * The behavioural halves — a real SMTP send, a real sink, real step states —
 * live in tests/journey/issuance-consequence.journey.ts and need a database.
 * These pins need nothing, so they run in every suite and every environment,
 * which is what makes the mutation battery meaningful: each protection below
 * can be deleted, and deleting it turns this file red immediately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BILLING_ERROR_FR } from "@/lib/process/billing/state";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const actions = read("lib/process/billing/actions.ts");
const emailFn = actions.slice(actions.indexOf("export async function emailValidatedInvoice"));
const prepareFn = actions.slice(
  actions.indexOf("async function prepareDispatchStep"),
  actions.indexOf("// ------------------------------------------------- 20. draft preparation ----"),
);

describe("C-4 — PREVENT: nothing irreversible before the consequence can land", () => {
  it("the preparation runs, and runs BEFORE the send", () => {
    const prepared = emailFn.indexOf("const prepared = await prepareDispatchStep(c, fileId);");
    const send = emailFn.indexOf("await queueAndSend(");
    expect(prepared, "the preparation must exist").toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(prepared, "and must precede the SMTP transaction").toBeLessThan(send);
    expect(emailFn).toContain("if (!prepared.ready) return fail(prepared.error);");
  });

  it("a step claimed by ANOTHER identity is refused", () => {
    expect(prepareFn).toContain("exec.assignedUserId && exec.assignedUserId !== ctx.userId");
    expect(prepareFn).toContain('error: "dispatch_step_claimed_by_another"');
  });

  it("an AVAILABLE step is claimed through the canonical mechanism", () => {
    // Not a direct write: the same activateStep an operator triggers, which
    // carries its own guard, CAS and audit.
    expect(prepareFn).toContain('await activateStep(fileId, "billing_dispatch")');
    expect(prepareFn).toContain('error: "dispatch_step_not_claimable"');
  });

  it("a step that is not reached or already closed is refused", () => {
    expect(prepareFn).toContain('if (exec.state !== "AVAILABLE") return { ready: false, error: "dispatch_step_not_reached" };');
  });

  it("the preparation does NOT rely on assertControlStep", () => {
    // Recorded because it is the obvious fix and it is insufficient: the
    // ACTIONABLE set includes AVAILABLE, so it passes in exactly the state that
    // produces the stall.
    expect(prepareFn).not.toContain("assertControlStep");
  });

  it("the billing lane still touches process state in NEITHER direction", () => {
    // The preparation reads through the engine's reader, so the existing
    // boundary pin holds without being loosened to allow a read.
    expect(actions).not.toContain("process_step_execution");
    expect(actions).not.toContain("process_handoff");
    expect(prepareFn).toContain("await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions)");
  });
});

describe("C-4 — NEVER LIE: a failed consequence is not ordinary success", () => {
  it("the submitStep result is CAPTURED, not discarded", () => {
    expect(emailFn).toContain('const advanced = await submitStep(fileId, "billing_dispatch");');
    // The exact shape of the defect: the call with its result thrown away.
    expect(emailFn).not.toMatch(/^\s*await submitStep\(fileId, "billing_dispatch"\);\s*$/m);
  });

  it("a failed consequence returns the distinct third state", () => {
    expect(emailFn).toContain("if (!advanced.ok) {");
    expect(emailFn).toContain('return fail("delivered_workflow_not_advanced");');
    // …and it is reached BEFORE the ordinary success return.
    const stall = emailFn.indexOf('return fail("delivered_workflow_not_advanced")');
    const ok = emailFn.indexOf("return { ok: true, id: invoiceId, status: sent.status };");
    expect(stall).toBeGreaterThan(-1);
    expect(ok).toBeGreaterThan(-1);
    expect(stall, "the stall is decided before ordinary success").toBeLessThan(ok);
  });

  it("the stall is AUDITED and attributed", () => {
    const stall = emailFn.slice(emailFn.indexOf("if (!advanced.ok) {"));
    expect(stall).toContain("AuditActions.PROCESS_DISPATCH_NOT_ADVANCED");
    expect(stall).toContain("actorId: c.userId");
    // The audit records what is true: delivered, issued, not advanced.
    expect(stall).toContain("delivered: true");
    expect(stall).toContain("invoice_issued: true");
  });

  it("the invoice is NOT rolled back and NO second send is attempted", () => {
    const stall = emailFn.slice(emailFn.indexOf("if (!advanced.ok) {"));
    // Undoing a delivery that happened would be a different lie.
    expect(stall).not.toContain('status: "VALIDATED"');
    expect(stall).not.toContain("queueAndSend(");
    expect(stall).not.toContain("sendEmail(");
  });

  it("the send itself is audited unconditionally — it happened", () => {
    const emailed = emailFn.indexOf("AuditActions.INVOICE_EMAILED");
    const stall = emailFn.indexOf("if (!advanced.ok) {");
    expect(emailed).toBeGreaterThan(-1);
    expect(emailed, "the delivery audit precedes the stall branch").toBeLessThan(stall);
  });
});

describe("C-4 — the operator can tell the four outcomes apart", () => {
  it("every new code has an operator sentence", () => {
    for (const code of [
      "dispatch_step_not_reached",
      "dispatch_step_claimed_by_another",
      "dispatch_step_not_claimable",
      "delivered_workflow_not_advanced",
    ] as const) {
      expect(BILLING_ERROR_FR[code], code).toBeTruthy();
    }
  });

  it("the pre-send refusals say plainly that nothing was sent", () => {
    for (const code of [
      "dispatch_step_not_reached",
      "dispatch_step_claimed_by_another",
      "dispatch_step_not_claimable",
    ] as const) {
      expect(BILLING_ERROR_FR[code], code).toContain("Rien n'a été envoyé");
    }
  });

  it("the third state is neither a success nor a retry instruction", () => {
    const fr = BILLING_ERROR_FR.delivered_workflow_not_advanced;
    // It must say the client HAS the invoice…
    expect(fr).toContain("envoyée au client");
    expect(fr).toContain("émise");
    // …and must explicitly refuse the wrong remedy.
    expect(fr).toContain("Ne renvoyez pas");
  });

  it("the caller refreshes on the third state too", () => {
    // Refreshing only on ok leaves a stale screen showing an unissued invoice,
    // which is how an operator decides to press send again.
    const queues = read("lib/process/queues/actions.ts");
    expect(queues).toContain('if (r.ok || r.error === "delivered_workflow_not_advanced") refresh("billing", fileId);');
  });
});

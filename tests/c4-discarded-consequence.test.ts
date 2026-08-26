/**
 * C-4 — the DISCARDED-CONSEQUENCE class, closed everywhere it was found.
 * ---------------------------------------------------------------------------
 * Four instances of one shape: an action performs its business mutation, fails
 * to advance the workflow, and reports success anyway.
 *
 *   emailValidatedInvoice   invoice emailed + ISSUED, step 22 not advanced
 *   handToCollections       custody moved, the canonical handoff never sent
 *   completeCollections     collections marked, step 26 not advanced
 *   closeDossier            process CLOSED, dossier NOT closed
 *
 * The invariant, ratified at the irreversible-send boundary and applied to the
 * class: a required workflow consequence that fails must never be reported as
 * ordinary success. Where the consequence can be attempted BEFORE the mutation,
 * it is — refusing costs nothing; discovering it afterwards costs a divergence.
 *
 * These are source pins ON PURPOSE, in a plain suite rather than a journey file:
 * a protection deleted here must redden immediately and everywhere, not only
 * where a database happens to be available.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const fn = (src: string, name: string) => {
  const i = src.indexOf(`export async function ${name}`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const j = src.indexOf("\nexport ", i + 1);
  return src.slice(i, j === -1 ? src.length : j);
};

const collections = read("lib/collections/actions.ts");
const billing = read("lib/process/billing/actions.ts");
const deposit = read("lib/deposit/actions.ts");

describe("C-4 — closeDossier: the dossier moves FIRST, so the two can never disagree", () => {
  const close = fn(collections, "closeDossier");

  it("the file transition precedes the process-instance close", () => {
    const file = close.indexOf('await transitionFile(fileId, "CLOSED")');
    const inst = close.indexOf('.update({ status: "CLOSED", closed_at: now, completed_at: now })');
    expect(file, "the dossier transition must exist").toBeGreaterThan(-1);
    expect(inst, "and the instance close").toBeGreaterThan(-1);
    expect(file, "the dossier moves first").toBeLessThan(inst);
  });

  it("a refused transition stops closure and is reported", () => {
    expect(close).toContain("const moved = await transitionFile(fileId, \"CLOSED\");");
    expect(close).toContain("if (!moved.ok) {");
    expect(close).toContain('return fail("closure_blocked", [moved.error]);');
    // …and it is audited, so a refusal is never merely absent.
    const branch = close.slice(close.indexOf("if (!moved.ok) {"), close.indexOf('return fail("closure_blocked", [moved.error]);'));
    expect(branch).toContain("AuditActions.DOSSIER_CLOSURE_BLOCKED");
  });

  it("process = CLOSED with dossier != CLOSED is now unreachable", () => {
    // The instance update is only reached after the transition succeeded, so
    // the divergence cannot be produced by this action at all.
    const guard = close.indexOf("if (!moved.ok) {");
    const inst = close.indexOf('.update({ status: "CLOSED", closed_at: now, completed_at: now })');
    expect(guard).toBeLessThan(inst);
  });
});

describe("C-4 — completeCollections keeps its own result", () => {
  const complete = fn(collections, "completeCollections");

  it("the submitStep result is captured, not discarded", () => {
    expect(complete).toContain('const advanced = await submitStep(resolved.fileId, "collections");');
    expect(complete).not.toMatch(/^\s*await submitStep\(resolved\.fileId, "collections"\);\s*$/m);
  });

  it("a failed step completion is not ordinary success", () => {
    expect(complete).toContain("if (!advanced.ok) {");
    expect(complete).toContain('return fail("step_completion_failed");');
    const branch = complete.slice(complete.indexOf("if (!advanced.ok) {"));
    expect(branch).toContain("AuditActions.PROCESS_DISPATCH_NOT_ADVANCED");
    // The collections mark IS committed; the audit says so rather than denying it.
    expect(branch).toContain("collections_marked: true");
  });
});

describe("C-4 — the class stays closed at the two sites already corrected", () => {
  it("emailValidatedInvoice still prepares first and never lies after", () => {
    const email = fn(billing, "emailValidatedInvoice");
    expect(email).toContain("const prepared = await prepareDispatchStep(c, fileId);");
    expect(email).toContain('const advanced = await submitStep(fileId, "billing_dispatch");');
    expect(email).toContain('return fail("delivered_workflow_not_advanced");');
  });

  it("handToCollections still completes before it sends, and requires the handoff", () => {
    const hand = fn(deposit, "handToCollections");
    const complete = hand.indexOf('const completed = await submitStep(d.fileId, "administration_proof_handoff");');
    const send = hand.indexOf("await sendHandoff(d.fileId,");
    expect(complete).toBeGreaterThan(-1);
    expect(complete, "completion precedes the handoff").toBeLessThan(send);
    expect(hand).toContain('return fail("handoff_not_sent");');
  });

  it("NO site in the class discards its workflow consequence any more", () => {
    // The generic sweep. A bare `await submitStep(...)` whose result is thrown
    // away is the exact shape of every instance found.
    for (const [label, src] of [
      ["collections", collections],
      ["billing", billing],
      ["deposit", deposit],
    ] as const) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const bare = [...code.matchAll(/^\s*await submitStep\(/gm)];
      expect(bare, `${label}: ${bare.length} discarded submitStep result(s)`).toHaveLength(0);
    }
  });
});

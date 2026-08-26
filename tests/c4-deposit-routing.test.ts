/**
 * C-4 — the Administration → Recouvrement routing (step 25 → 26).
 * ---------------------------------------------------------------------------
 * RATIFIED INVARIANT:
 *
 *   A departmental handoff may be sent only after its declared from_step is
 *   complete, and a required handoff failure must never be silently tolerated.
 *
 * THE REGRESSION THIS CLOSES. C-2 forbids a handoff from an unfinished step.
 * `handToCollections` sent its handoff one line BEFORE completing step 25, so
 * every call since C-2 shipped was refused `from_step_incomplete` — and the
 * refusal was absorbed by `handoff.ok ? handoff.id : null`, so the canonical
 * transfer was never created, custody recorded a null link, and the action
 * returned success. Step 26 opened by bare promotion instead.
 *
 * PROMOTION establishes eligibility; a HANDOFF establishes departmental
 * custody. One silently standing in for the other is the defect.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const deposit = read("lib/deposit/actions.ts");
const handFn = deposit.slice(deposit.indexOf("export async function handToCollections"));
/**
 * CODE ONLY. The comment inside the function legitimately QUOTES the old
 * degrading expression to explain what was wrong; a whole-text check fails on
 * that prose while proving nothing.
 */
const handCode = handFn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("C-4 — step 25 completes BEFORE its handoff is sent", () => {
  it("the order is completion, then handoff", () => {
    const complete = handFn.indexOf('const completed = await submitStep(d.fileId, "administration_proof_handoff");');
    const send = handFn.indexOf('await sendHandoff(d.fileId, "administration_proof_handoff", "collections")');
    expect(complete, "step 25 is completed here").toBeGreaterThan(-1);
    expect(send, "and the handoff is sent here").toBeGreaterThan(-1);
    expect(complete, "completion must precede the handoff").toBeLessThan(send);
  });

  it("C-2 is untouched — the generic guard still refuses an unfinished from-step", () => {
    // The correction satisfies C-2 on its own terms. Relaxing the guard to
    // permit sending from ACTIVE would restore the outrunning it prevents,
    // across every handoff in the platform, to fix one call site's ordering.
    const engine = read("lib/process/engine/actions.ts");
    expect(engine).toContain('if (!from || !isDone(from.state)) return fail("from_step_incomplete");');
  });
});

describe("C-4 — a required handoff is never silently tolerated", () => {
  it("the degrading expression is gone", () => {
    expect(handCode).not.toContain("handoff.ok ? handoff.id : null");
  });

  it("a failed step completion stops before the handoff and reports it", () => {
    expect(handFn).toContain("if (!completed.ok) {");
    expect(handFn).toContain('return fail("step_completion_failed");');
    // …and does not go on to fabricate custody.
    const branch = handFn.slice(handFn.indexOf("if (!completed.ok) {"), handFn.indexOf('return fail("step_completion_failed");'));
    expect(branch).not.toContain("recordCustody(");
    expect(branch).toContain("AuditActions.DEPOSIT_ROUTING_FAILED");
  });

  it("a failed handoff is reported, and custody is NOT invented", () => {
    expect(handFn).toContain("if (!handoff.ok) {");
    expect(handFn).toContain('return fail("handoff_not_sent");');
    const branch = handFn.slice(handFn.indexOf("if (!handoff.ok) {"), handFn.indexOf('return fail("handoff_not_sent");'));
    expect(branch).not.toContain("recordCustody(");
    expect(branch).toContain("AuditActions.DEPOSIT_ROUTING_FAILED");
    // The factual state is preserved and stated, not undone or denied.
    expect(branch).toContain("step_completed: true");
  });

  it("custody references the REAL handoff id", () => {
    const custody = handFn.slice(handFn.indexOf("await recordCustody(c, d, \"HANDED_TO_COLLECTIONS\""));
    expect(custody).toContain("handoffId: handoff.id");
    expect(custody).not.toContain("handoffId: null");
  });

  it("the custody write happens only AFTER both succeeded", () => {
    const send = handFn.indexOf("if (!handoff.ok) {");
    const custody = handFn.indexOf('await recordCustody(c, d, "HANDED_TO_COLLECTIONS"');
    expect(custody, "custody is recorded after the handoff is known good").toBeGreaterThan(send);
  });
});

describe("C-4 — reception stays explicit", () => {
  it("nothing auto-receives the Collections handoff", () => {
    // The action SENDS. Receiving is Recouvrement's own act, and no code path
    // may quietly perform it for them — that is what makes custody a transfer
    // rather than a label.
    expect(handFn).not.toContain("receiveHandoff(");
  });
});

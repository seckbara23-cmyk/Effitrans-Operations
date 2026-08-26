/**
 * C-4 — step 24 completes on a VERIFIED proof, not on a returned one.
 * ---------------------------------------------------------------------------
 * RATIFIED: `courier_deposit` requires PROOF_OF_DEPOSIT as evidence, and that
 * key is satisfied only by a VERIFIED document. Therefore the step cannot
 * complete when the courier merely returns the proof.
 *
 * The business sequence:
 *   courier returns the proof → it stays pending review → an INDEPENDENT
 *   Administration actor verifies it → only then may step 24 complete.
 *
 * THE DEFECT THIS CLOSES. `submitProof` asserted "Official step 24 completes
 * only now" and called `submitStep(courier_deposit)` at a moment when the proof
 * was unreviewed — so `evaluateStepEvidence` reported `pending_review` and the
 * completion could never succeed. It never once did. The attempt's result was
 * discarded, so the step silently stayed ACTIVE and somebody closed it later;
 * the six-site discarded-consequence correction is what exposed it, on the
 * first real CI run after it shipped.
 *
 * Nothing about the evidence model moved to fix it: PROOF_OF_DEPOSIT is
 * unchanged, `approvedDoc` is untouched, and the engine re-evaluates the same
 * gate. Only the MOMENT of the attempt moved — to when the evidence exists.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getNode } from "@/lib/process/engine/state";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const deposit = read("lib/deposit/actions.ts");
const fn = (name: string) => {
  const i = deposit.indexOf(`export async function ${name}`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const j = deposit.indexOf("\nexport ", i + 1);
  return deposit.slice(i, j === -1 ? deposit.length : j);
};

describe("C-4 — the gate that makes the sequence necessary", () => {
  it("step 24 requires PROOF_OF_DEPOSIT — unchanged", () => {
    const node = getNode("courier_deposit") as { requiredDocuments?: string[] } | null;
    expect(node?.requiredDocuments).toContain("PROOF_OF_DEPOSIT");
  });

  it("that key is satisfied only by a VERIFIED document — unchanged", () => {
    // The shared semantic. Weakening it to admit an uploaded proof would have
    // been the easy fix and would have degraded every consumer of approvedDoc.
    const evidence = read("lib/process/engine/evidence.ts");
    expect(evidence).toContain("function approvedDoc(snap: EvidenceSnapshot, typeCode: string): boolean {");
    expect(evidence).toContain("d.typeCode === typeCode && isVerified(d.status)");
  });
});

describe("C-4 — submitProof returns the proof and claims nothing about step 24", () => {
  const submit = fn("submitProof");

  it("it no longer attempts the impossible completion", () => {
    expect(submit).not.toContain('submitStep(d.fileId, "courier_deposit")');
  });

  it("it still records what it actually did", () => {
    expect(submit).toContain('status: "PROOF_SUBMITTED"');
    expect(submit).toContain('recordCustody(c, d, "PROOF_SUBMITTED"');
    expect(submit).toContain("AuditActions.DEPOSIT_PROOF_SUBMITTED");
  });

  it("and reports ordinary success for its own mutation", () => {
    expect(submit).toContain("return { ok: true, id: depositId };");
  });
});

describe("C-4 — acceptProof verifies, and leaves the step to its courier", () => {
  const accept = fn("acceptProof");

  it("independent review is unchanged — the courier may never verify its own proof", () => {
    expect(accept).toContain('if (d.courierUserId === c.userId) return fail("self_review_forbidden");');
    expect(accept).toContain('if (!d.proofDocumentId) return fail("proof_required");');
  });

  it("it verifies the proof", () => {
    expect(accept).toContain('.update({ status: "VERIFIED", reviewed_by: c.userId })');
    expect(accept).toContain('status: "PROOF_ACCEPTED"');
    expect(accept).toContain("validated_by_admin: c.userId");
  });

  it("and does NOT complete step 24 — verifying is not performing", () => {
    // Step 24's gate is courier:deposit. An Administrative Officer does not hold
    // it and should not: Section G exists to keep verification and execution
    // apart. Completing it here would have required granting Administration the
    // courier's permission, or a system principal to dodge the question —
    // either of which erases the separation the step is built on.
    const code = accept.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain('submitStep(d.fileId, "courier_deposit")');
    expect(code).not.toContain('state: "COMPLETED"');
  });

  it("nobody bridged the sequence with borrowed authority", () => {
    const deposit_ = read("lib/deposit/actions.ts");
    const code = deposit_.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // No system attribution, no invented principal, and Administration was
    // never granted the courier's permission to make this work.
    expect(code).not.toContain("PROCESS_STEP_ACTIVATED_SYSTEM");
    const templates = read("lib/platform/role-templates.ts");
    const i = templates.indexOf('key: "ADMINISTRATIVE_OFFICER"');
    // Bounded at the NEXT role, or the slice runs into COURIER's own block and
    // finds the permission there.
    const block = templates.slice(i, templates.indexOf('key: "', i + 10));
    expect(block, "Administration must not hold courier:deposit").not.toContain('"courier:deposit"');
  });
});

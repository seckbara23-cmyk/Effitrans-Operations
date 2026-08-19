/**
 * TMS-7 / DEFECT-UAT15 — a document-verification refusal must name itself.
 * ---------------------------------------------------------------------------
 * Production evidence: on a dossier with NO process instance, « Vérifier »
 * failed with the anonymous « L'action a échoué. Veuillez réessayer. » The
 * refusal was CORRECT — governance binds the verifier seat to the dossier's
 * current process STEP, and a dossier that was never opened has no step, so no
 * verifier exists. The correlation in production was exact: the only dossier
 * with a process instance was the only one with verified documents.
 *
 * Nothing about the control changed. What changed is that the operator is now
 * told which of the three governance refusals happened, and what to do.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { t } from "@/lib/i18n";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const governance = read("lib", "documents", "governance.ts");
const actions = read("lib", "documents", "actions.ts");
const seat = read("lib", "workflow", "access", "seat.ts");
const errors = t.documents.errors as Record<string, string>;

describe("DEFECT-UAT15 — every governance refusal has a French explanation", () => {
  it("the three refusal codes mayVerifyDocument can return are all mapped", () => {
    for (const code of ["policy_unresolved", "not_a_verifier", "self_verification"]) {
      expect(governance, code).toContain(`error: "${code}"`);
      expect(errors[code], code).toBeTruthy();
      expect(errors[code], code).not.toBe(errors.generic);
    }
  });

  it("the RPC-side codes are mapped too — none falls through to generic", () => {
    for (const code of ["self_verification", "reason_required", "invalid_transition", "not_found", "review_failed"]) {
      expect(actions, code).toContain(`"${code}"`);
      expect(errors[code], code).toBeTruthy();
      expect(errors[code], code).not.toBe(errors.generic);
    }
  });

  it("the « not a verifier » message tells the operator what to DO", () => {
    // The production cause was a dossier that had never been opened, so the
    // message must point at opening it rather than merely refusing.
    expect(errors.not_a_verifier).toContain("Ouvrez le dossier");
    expect(errors.not_a_verifier.toLowerCase()).toContain("processus");
  });

  it("self-verification is explained as maker-checker, not as a failure", () => {
    expect(errors.self_verification).toContain("vous avez vous-même téléversé");
    expect(errors.self_verification).toContain("Un autre collaborateur");
  });
});

describe("DEFECT-UAT15 — the control itself is untouched", () => {
  it("verification is still refused when no verifier seat resolves", () => {
    expect(seat).toContain("if (eligibility.roles.length === 0) return false;");
    expect(governance).toContain('return { ok: false, error: "not_a_verifier" }');
  });

  it("maker-checker still refuses the uploader verifying their own document", () => {
    expect(governance).toContain("input.uploaderId === input.actorId");
    expect(governance).toContain('return { ok: false, error: "self_verification" }');
  });

  it("the verifier seat is still resolved from the PINNED policy, per step", () => {
    expect(governance).toContain('resolveSeatEligibility(ctx, stepKey, "verifier")');
    expect(governance).toContain("if (!verifier.resolved) return UNRESOLVED;");
  });

  it("no verification bypass was introduced", () => {
    for (const bypass of ["skipGovernance", "forceVerify", "ignoreMakerChecker", "bypassPolicy"]) {
      expect(actions, bypass).not.toContain(bypass);
      expect(governance, bypass).not.toContain(bypass);
    }
  });
});

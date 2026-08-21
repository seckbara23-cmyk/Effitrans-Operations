/**
 * Deposit debt — the module stops minting legacy document-status vocabulary.
 * ---------------------------------------------------------------------------
 * The deposit flow wrote `PENDING_REVIEW` on upload and `APPROVED` on
 * acceptance: both legacy aliases of `UNDER_REVIEW` and `VERIFIED`. Nothing was
 * broken — `isVerified` and `canReview` accept both spellings — but new rows
 * kept the alias load-bearing instead of letting it become history.
 *
 * The audit found the path had NEVER executed in production (zero deposits,
 * zero PROOF_OF_DEPOSIT documents), so this is a pure rename with no migration,
 * no backfill and nothing to reconcile.
 *
 * TWO things this must NOT do, and both are pinned:
 *
 *   1. remove `LEGACY_STATUS_ALIAS` — 8 historic production documents carry
 *      `APPROVED` with `provenance = 'LEGACY_VERIFIED'`, and they are HISTORY;
 *   2. route acceptance through `runReview` — that asserts `document:approve`,
 *      which ADMINISTRATIVE_OFFICER does not hold, so the tidy-looking fix would
 *      lock out the role that exists to validate a courier's deposit proof.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  LEGACY_STATUS_ALIAS,
  canonicalStatus,
  isVerified,
} from "@/lib/documents/doctrine";
import { canReview, isDocumentStatus } from "@/lib/documents/status";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const deposit = read("lib", "deposit", "actions.ts");
const code = deposit.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * `acceptProof` alone, bounded. Several guards in this module are byte-identical
 * between `acceptProof` and `rejectProof`, so a whole-file assertion can be
 * satisfied by the wrong function — which is exactly how a widened accept gate
 * first slipped past this suite.
 */
const acceptFn = (() => {
  const start = code.indexOf("export async function acceptProof");
  const end = code.indexOf("export async function", start + 40);
  const slice = code.slice(start, end);
  if (start < 0 || end < 0 || slice.length < 300) throw new Error("acceptProof slice not found");
  return slice;
})();

describe("deposit debt — the ACCEPT write is canonical", () => {
  it("an accepted proof becomes VERIFIED, not APPROVED", () => {
    expect(code).toContain('.update({ status: "VERIFIED", reviewed_by: c.userId })');
    expect(code).not.toContain('status: "APPROVED"');
  });

  it("the accepted proof reads as verified downstream", () => {
    expect(isVerified("VERIFIED")).toBe(true);
  });

  it("nothing validates the accept write, so the canonical value is safe here", () => {
    // The accept is a DIRECT update on `document`, and this module imports NO
    // document-status predicate — `canTransitionDeposit` governs the DEPOSIT
    // machine, which is a different vocabulary entirely. So no predicate could
    // reject `VERIFIED`, which is precisely why this half was safe to move while
    // the upload half was not.
    expect(code).toContain('.from("document")');
    expect(code).not.toContain('from "@/lib/documents/status"');
    expect(code).not.toContain("canReview(");
  });
});

/**
 * THE BLOCKER IS GONE — and these assertions are the ones that flipped.
 *
 * They previously read « canReview does NOT yet accept the canonical spelling »
 * and « the upload deliberately still writes the legacy value ». That was
 * deliberate: the pins were written to FAIL the moment `canReview` normalized,
 * so the debt could not be silently forgotten. `canReview` now delegates to
 * `isPendingReview`, so the upload write is canonical too and the deposit module
 * mints no legacy vocabulary at all.
 */
describe("deposit debt — the upload write is canonical now that canReview normalizes", () => {
  it("canReview accepts the CANONICAL spelling", () => {
    expect(canReview("UNDER_REVIEW")).toBe(true);
  });

  it("canReview still accepts the legacy spelling — historic rows keep working", () => {
    expect(canReview("PENDING_REVIEW")).toBe(true);
  });

  it("the upload now writes UNDER_REVIEW", () => {
    expect(code).toContain('status: "UNDER_REVIEW"');
  });

  it("the deposit module mints NO legacy document status any more", () => {
    // Bounded to THIS file: a legacy spelling elsewhere must not satisfy it.
    expect(code).not.toContain('status: "PENDING_REVIEW"');
    expect(code).not.toContain('status: "APPROVED"');
  });

  it("the legacy TYPE is still a fossil — recorded, deliberately not removed", () => {
    // The Phase 1.8 union cannot represent the canonical value, which is why
    // `canReview` takes `string`. Removing it is separate fossil-cleanup debt.
    expect(isDocumentStatus("UNDER_REVIEW")).toBe(false);
    expect(isDocumentStatus("PENDING_REVIEW")).toBe(true);
  });
});

describe("deposit debt — history is preserved, not rewritten", () => {
  it("LEGACY_STATUS_ALIAS still maps BOTH spellings", () => {
    // 8 production documents carry APPROVED with provenance LEGACY_VERIFIED.
    // Dropping either key would strand them.
    expect(LEGACY_STATUS_ALIAS.APPROVED).toBe("VERIFIED");
    expect(LEGACY_STATUS_ALIAS.PENDING_REVIEW).toBe("UNDER_REVIEW");
  });

  it("a historic APPROVED row still reads as verified", () => {
    expect(isVerified("APPROVED")).toBe(true);
    expect(canonicalStatus("APPROVED")).toBe("VERIFIED");
  });

  it("a historic PENDING_REVIEW row is still reviewable", () => {
    expect(canReview("PENDING_REVIEW")).toBe(true);
    expect(canonicalStatus("PENDING_REVIEW")).toBe("UNDER_REVIEW");
  });
});

describe("deposit debt — the parallel controls are untouched", () => {
  it("the courier can never review their own proof", () => {
    expect(code).toContain('if (d.courierUserId === c.userId) return fail("self_review_forbidden");');
  });

  it("acceptance still requires PROOF_SUBMITTED, and still uses CAS", () => {
    expect(code).toContain('if (d.status !== "PROOF_SUBMITTED") return fail("invalid_state");');
    expect(code).toContain('cas(c.tenantId, depositId, "PROOF_SUBMITTED", {');
  });

  it("the custody ledger entry survives", () => {
    expect(code).toContain('recordCustody(c, d, "PROOF_ACCEPTED", "PROOF_SUBMITTED", "PROOF_ACCEPTED"');
  });

  it("the audit action survives", () => {
    expect(code).toContain("action: AuditActions.DEPOSIT_PROOF_ACCEPTED");
  });

  it("acceptance is still gated on admin_service:manage", () => {
    // Bounded to acceptProof. `rejectProof` carries an IDENTICAL guard line, so
    // a whole-file toContain stayed green when only acceptProof's gate was
    // widened — the pin was satisfied by the neighbouring function.
    expect(acceptFn).toContain('guard("admin_service:manage", fileId)');
    expect(acceptFn).not.toContain('guard("document:read"');
  });
});

describe("deposit debt — acceptance is NOT routed through document governance", () => {
  it("the module does not call the generic review path", () => {
    // Deliberate, and deferred as a product-governance question: runReview
    // asserts document:approve, which ADMINISTRATIVE_OFFICER does not hold.
    for (const generic of ["runReview", "verifyDocument", "mayVerifyDocument"]) {
      expect(code, generic).not.toContain(generic);
    }
  });

  it("the comment no longer claims it uses the document workflow", () => {
    expect(deposit).not.toContain("through the EXISTING document workflow");
    expect(deposit).toContain("This is a DIRECT update, NOT the `verifyDocument → runReview` path");
  });
});

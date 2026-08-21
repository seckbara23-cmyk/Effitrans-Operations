/**
 * Document-status vocabulary — the review affordance normalizes at last.
 * ---------------------------------------------------------------------------
 * `canReview()` compared the RAW string and accepted only `UPLOADED` or
 * `PENDING_REVIEW`, so a document carrying the canonical `UNDER_REVIEW` was
 * invisible to it and « Vérifier » never rendered. That one predicate was what
 * blocked canonical spellings anywhere: the deposit module could not stop
 * minting `PENDING_REVIEW` without making its own proofs unreviewable.
 *
 * THE AUDIT'S DECISIVE FINDING: the SERVER already accepted `UNDER_REVIEW`. The
 * `review_document` RPC guards by BLOCKLIST — it refuses a no-op transition,
 * refuses SUPERSEDED / CONSUMED_AS_EVIDENCE, and refuses verifying a rejected
 * version — but never required the legacy status. So this predicate was hiding a
 * button the server would have honoured.
 *
 * RECOGNITION, NOT AUTHORIZATION. Widening it grants nobody anything, and the
 * last describe block here exists to keep that true.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { canReview } from "@/lib/documents/status";
import { isPendingReview, isVerified, LEGACY_STATUS_ALIAS } from "@/lib/documents/doctrine";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const statusSrc = strip(read("lib", "documents", "status.ts"));
const rowSrc = strip(read("components", "documents", "document-row.tsx"));
const actionsSrc = strip(read("lib", "documents", "actions.ts"));
const copilot = strip(read("lib", "copilot", "context.ts"));
const classify = strip(read("lib", "departments", "classify.ts"));
const lifecycle = strip(read("lib", "files", "lifecycle.ts"));

describe("canReview — the canonical status is recognized", () => {
  it("UNDER_REVIEW is reviewable", () => {
    expect(canReview("UNDER_REVIEW")).toBe(true);
  });

  it("UPLOADED is still reviewable", () => {
    expect(canReview("UPLOADED")).toBe(true);
  });

  it("the legacy PENDING_REVIEW is still reviewable — via the alias", () => {
    expect(canReview("PENDING_REVIEW")).toBe(true);
    expect(LEGACY_STATUS_ALIAS.PENDING_REVIEW).toBe("UNDER_REVIEW");
  });

  it("it delegates to the doctrine, so affordance and counters cannot disagree", () => {
    expect(statusSrc).toContain("return isPendingReview(status);");
  });
});

describe("canReview — the widening is NOT a hole", () => {
  it("already-decided statuses remain NON-reviewable", () => {
    for (const s of ["VERIFIED", "APPROVED", "REJECTED", "SUPERSEDED", "CONSUMED_AS_EVIDENCE", "EXPIRED"]) {
      expect(canReview(s), s).toBe(false);
    }
  });

  it("a historic APPROVED document is not re-reviewable", () => {
    // 8 such rows exist in production, all provenance LEGACY_VERIFIED. They are
    // decided history and must stay that way.
    expect(canReview("APPROVED")).toBe(false);
    expect(isVerified("APPROVED")).toBe(true);
  });

  it("an unknown status is not reviewable", () => {
    expect(canReview("NOT_A_STATUS")).toBe(false);
    expect(canReview("")).toBe(false);
  });
});

describe("pending-document counters use canonical semantics", () => {
  it("isPendingReview accepts both spellings and nothing decided", () => {
    expect(isPendingReview("UNDER_REVIEW")).toBe(true);
    expect(isPendingReview("PENDING_REVIEW")).toBe(true);
    expect(isPendingReview("UPLOADED")).toBe(true);
    for (const s of ["VERIFIED", "APPROVED", "REJECTED", "SUPERSEDED", "CONSUMED_AS_EVIDENCE"]) {
      expect(isPendingReview(s), s).toBe(false);
    }
  });

  it("all three counters route through it", () => {
    for (const [name, src] of [["copilot", copilot], ["classify", classify], ["lifecycle", lifecycle]] as const) {
      expect(src, name).toContain("isPendingReview(d.status)");
    }
  });

  it("none of them compares the raw legacy pair any more", () => {
    for (const [name, src] of [["copilot", copilot], ["classify", classify], ["lifecycle", lifecycle]] as const) {
      expect(src, name).not.toContain('d.status === "PENDING_REVIEW"');
      expect(src, name).not.toContain('d.status === "UPLOADED"');
    }
  });
});

describe("NO authorization was broadened", () => {
  it("the row still requires document:approve before offering review", () => {
    // Bounded to the row component. `canReview` alone must never decide this —
    // it answers "is this reviewable", not "may YOU review it".
    expect(rowSrc).toContain("const reviewable = canApprove && canReview(doc.status);");
  });

  it("the server still asserts the permission", () => {
    expect(actionsSrc).toContain('runReview(id, "VERIFIED", "document:approve", null, null)');
  });

  it("the verifier seat and maker-checker are still consulted", () => {
    expect(actionsSrc).toContain("await mayVerifyDocument({");
    expect(actionsSrc).toContain("if (!check.ok) return { ok: false, error: check.error };");
  });

  it("canReview grants nothing by itself — it takes only a status", () => {
    // No permission, no user, no policy: it cannot express authority even by
    // accident.
    expect(statusSrc).toContain("export function canReview(status: string): boolean {");
    expect(statusSrc).not.toContain("permission");
    expect(statusSrc).not.toContain("assertPermission");
  });
});

describe("the fossil is recorded, not removed", () => {
  it("LEGACY_STATUS_ALIAS still maps both keys", () => {
    expect(LEGACY_STATUS_ALIAS.PENDING_REVIEW).toBe("UNDER_REVIEW");
    expect(LEGACY_STATUS_ALIAS.APPROVED).toBe("VERIFIED");
  });

  it("the legacy state machine is still present — deliberately untouched", () => {
    // Removing the Phase 1.8 type, ALLOWED map, canTransition, canSubmit and
    // isDocumentStatus is separate fossil-cleanup debt.
    expect(statusSrc).toContain("export function canTransition(");
    expect(statusSrc).toContain("export function canSubmit(");
  });
});

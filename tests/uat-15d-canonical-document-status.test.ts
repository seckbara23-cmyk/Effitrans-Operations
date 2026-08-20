/**
 * TMS-7 / DEFECT-UAT15d — share and notify keyed on the LEGACY alias.
 * ---------------------------------------------------------------------------
 * The platform writes `VERIFIED`; `APPROVED` is only the legacy spelling that
 * `canonicalStatus` maps onto it. Two gates still compared the raw string:
 *
 *   * the share control in document-row.tsx,
 *   * the notify control beside it,
 *   * and — the one that mattered — `notifyDocumentShared` on the SERVER.
 *
 * Effect in production: a correctly VERIFIED document could never be shared to
 * the portal or announced to the client, while the shared/not-shared indicator
 * two lines above already normalized, so the row disagreed with itself.
 *
 * Both halves move together on purpose. Fixing only the button would have made
 * the UI offer an action the server then refused with `not_shared` — the exact
 * UI/authority disagreement this phase has been hunting.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { isVerified, canonicalStatus, isShareable } from "@/lib/documents/doctrine";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const row = read("components", "documents", "document-row.tsx");
const comms = read("lib", "comms", "actions.ts");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const rowCode = strip(row);
const commsCode = strip(comms);

describe("DEFECT-UAT15d — canonical VERIFIED is treated as verified", () => {
  it("the canonical status exposes share/notify", () => {
    expect(isVerified("VERIFIED")).toBe(true);
  });

  it("the legacy APPROVED alias still does — compatibility preserved", () => {
    // Historic rows carry APPROVED. They must keep working: this fix widens
    // recognition, it never narrows it.
    expect(canonicalStatus("APPROVED")).toBe("VERIFIED");
    expect(isVerified("APPROVED")).toBe(true);
  });

  it("a document consumed as evidence is verified too", () => {
    expect(isVerified("CONSUMED_AS_EVIDENCE")).toBe(true);
  });

  it("non-verified states expose NOTHING", () => {
    for (const s of ["UPLOADED", "UNDER_REVIEW", "PENDING_REVIEW", "REJECTED", "SUPERSEDED", "DRAFT"]) {
      expect(isVerified(s), s).toBe(false);
    }
  });
});

describe("DEFECT-UAT15d — both gates use the canonical predicate", () => {
  it("the share control no longer compares the raw alias", () => {
    expect(rowCode).not.toContain('doc.status === "APPROVED"');
    expect(rowCode).toContain("canApprove && isVerified(doc.status)");
  });

  it("the notify control no longer compares the raw alias", () => {
    expect(rowCode).toContain("canEmail && isVerified(doc.status) && doc.sharedWithClient");
  });

  it("the SERVER notify guard moved with them", () => {
    expect(commsCode).not.toContain('doc.status !== "APPROVED"');
    expect(commsCode).toContain("!doc.shared_with_client || !isVerified(doc.status)");
  });

  it("the row is internally consistent — indicator and controls agree", () => {
    // The indicator always normalized; that disagreement WAS the defect.
    expect(rowCode).toContain("isVerified(doc.status)");
    expect(rowCode).not.toMatch(/doc\.status\s*===\s*"APPROVED"/);
  });
});

describe("DEFECT-UAT15d — nothing else was loosened", () => {
  it("the server remains the stricter authority for sharing", () => {
    // isShareable additionally demands a client-safe type and a live version,
    // so the UI can never offer what setDocumentShared would refuse.
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "VERIFIED", supersededById: null })).toBe(true);
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "VERIFIED", supersededById: "x" })).toBe(false);
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "UPLOADED", supersededById: null })).toBe(false);
  });

  it("sharing still refuses a document that is not client-safe", () => {
    expect(isShareable({ typeCode: "INTERNAL_MEMO", status: "VERIFIED", supersededById: null })).toBe(false);
  });

  it("verification semantics are untouched — review still gates on its own rule", () => {
    expect(rowCode).toContain("canApprove && canReview(doc.status)");
  });

  it("no RBAC gate was removed from either control", () => {
    expect(rowCode).toContain("canApprove && isVerified(doc.status)");
    expect(rowCode).toContain("canEmail && isVerified(doc.status)");
    expect(commsCode).toContain("shared_with_client");
  });

  it("maker-checker is not referenced here and stays where it belongs", () => {
    for (const t of ["makerChecker", "self_verification", "mayVerifyDocument"]) {
      expect(rowCode, t).not.toContain(t);
    }
  });
});

/**
 * TMS-7 / DEFECT-UAT15d (analytics half) — the shared-document undercount.
 * ---------------------------------------------------------------------------
 * The shared-documents metric filtered `.eq("status", "APPROVED")` at the
 * DATABASE, so every canonically VERIFIED shared document was missing from the
 * total. A DB filter cannot call `isVerified` — the normalization lives in
 * TypeScript — so the stored spellings are DERIVED from the doctrine alias map
 * instead of hand-listed, because a hand-kept copy is precisely what drifted.
 *
 * These tests pin the derivation in BOTH directions: everything in the list is
 * verified, and everything verified is in the list. That round trip is what
 * stops the next status from being silently forgotten.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DOCUMENT_STATUSES,
  LEGACY_STATUS_ALIAS,
  VERIFIED_CANONICAL_STATUSES,
  VERIFIED_STORED_STATUSES,
  isVerified,
} from "@/lib/documents/doctrine";

const root = path.join(__dirname, "..");
const analytics = fs.readFileSync(path.join(root, "lib", "analytics", "service.ts"), "utf-8");

describe("DEFECT-UAT15d/analytics — what the count now includes", () => {
  it("canonical VERIFIED is counted — the documents that were missing", () => {
    expect(VERIFIED_STORED_STATUSES).toContain("VERIFIED");
  });

  it("legacy APPROVED is STILL counted — compatibility preserved", () => {
    // Live rows carry APPROVED, and lib/deposit/actions.ts still writes it.
    // Dropping it would trade one undercount for another.
    expect(VERIFIED_STORED_STATUSES).toContain("APPROVED");
  });

  it("a document consumed as evidence is counted", () => {
    expect(VERIFIED_STORED_STATUSES).toContain("CONSUMED_AS_EVIDENCE");
  });

  it("non-verified statuses are EXCLUDED", () => {
    for (const s of ["UPLOADED", "UNDER_REVIEW", "PENDING_REVIEW", "REJECTED", "SUPERSEDED", "DRAFT"]) {
      expect(VERIFIED_STORED_STATUSES, s).not.toContain(s);
    }
  });
});

describe("DEFECT-UAT15d/analytics — the derivation round-trips", () => {
  it("everything in the list is verified", () => {
    for (const s of VERIFIED_STORED_STATUSES) {
      expect(isVerified(s), s).toBe(true);
    }
  });

  it("everything verified is in the list — no stored spelling forgotten", () => {
    const everyStoredSpelling = [...DOCUMENT_STATUSES, ...Object.keys(LEGACY_STATUS_ALIAS)];
    for (const s of everyStoredSpelling) {
      if (isVerified(s)) expect(VERIFIED_STORED_STATUSES, s).toContain(s);
    }
  });

  it("isVerified is derived from the canonical set, not a second list", () => {
    for (const s of VERIFIED_CANONICAL_STATUSES) expect(isVerified(s), s).toBe(true);
  });

  it("the legacy half is derived from the alias map, not transcribed", () => {
    // Every alias pointing at a verified canonical status must appear.
    for (const [stored, canonical] of Object.entries(LEGACY_STATUS_ALIAS)) {
      if ((VERIFIED_CANONICAL_STATUSES as readonly string[]).includes(canonical)) {
        expect(VERIFIED_STORED_STATUSES, stored).toContain(stored);
      }
    }
  });
});

describe("DEFECT-UAT15d/analytics — the query itself", () => {
  const line = analytics.split("\n").find((l) => l.includes('scopedFrom(supabase, "document"')) ?? "";

  it("the metric no longer filters on the bare legacy spelling", () => {
    expect(line).not.toContain('.eq("status", "APPROVED")');
  });

  it("it filters on the derived list", () => {
    expect(line).toContain('.in("status", [...VERIFIED_STORED_STATUSES])');
  });

  it("it still counts only SHARED, non-deleted documents", () => {
    // The fix widens the status filter and nothing else.
    expect(line).toContain('.eq("shared_with_client", true)');
    expect(line).toContain('.is("deleted_at", null)');
  });

  it("it is still tenant-scoped", () => {
    expect(line).toContain("scopedFrom(supabase, \"document\", tenant)");
  });
});

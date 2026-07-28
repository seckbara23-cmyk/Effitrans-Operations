/**
 * UAT-1 blocker — POD_RECEIVED was unreachable.
 *
 * WES-4 renamed the canonical verified status to VERIFIED and WES-5 moves a
 * consumed document on to CONSUMED_AS_EVIDENCE. Two gates still compared to the
 * legacy "APPROVED" and therefore never matched anything `approveDocument`
 * writes:
 *
 *   * the transport POD gate    (lib/transport/actions.ts -> canReceivePod)
 *   * the engine evidence check (lib/process/engine/evidence.ts -> approvedDoc)
 *
 * Both now use the canonical `isVerified` predicate. These tests pin that a
 * VERIFIED and a CONSUMED_AS_EVIDENCE POD satisfy the gates, that the legacy
 * APPROVED still does, and that nothing else does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isVerified, canonicalStatus } from "@/lib/documents/doctrine";
import { canReceivePod } from "@/lib/transport/gates";
import { podReceived, type EvidenceSnapshot } from "@/lib/process/engine/evidence";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Mirrors the one-line filter in `approvedDocCodes`, using the REAL predicate. */
const podGateCodes = (docs: { type_code: string; status: string }[]) =>
  docs.filter((d) => isVerified(d.status)).map((d) => d.type_code);

const snapshotWithPod = (status: string): EvidenceSnapshot => ({
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [{ typeCode: "DELIVERY_NOTE", status }],
  customs: null,
  transport: null,
  invoices: [],
});

// ---------------------------------------------------------------------------
describe("the transport POD gate accepts the canonical statuses", () => {
  it("VERIFIED POD allows POD_RECEIVED — the defect that blocked UAT-1", () => {
    expect(canReceivePod(podGateCodes([{ type_code: "DELIVERY_NOTE", status: "VERIFIED" }]))).toBe(true);
  });

  it("CONSUMED_AS_EVIDENCE POD allows POD_RECEIVED", () => {
    expect(canReceivePod(podGateCodes([{ type_code: "DELIVERY_NOTE", status: "CONSUMED_AS_EVIDENCE" }]))).toBe(true);
  });

  it("legacy APPROVED remains accepted — historical rows keep working", () => {
    expect(canReceivePod(podGateCodes([{ type_code: "DELIVERY_NOTE", status: "APPROVED" }]))).toBe(true);
  });

  it("refuses an unverified or rejected POD", () => {
    for (const status of ["UPLOADED", "PENDING_REVIEW", "UNDER_REVIEW", "REJECTED", "EXPIRED", "SUPERSEDED"]) {
      expect(canReceivePod(podGateCodes([{ type_code: "DELIVERY_NOTE", status }])), status).toBe(false);
    }
  });

  it("refuses when no delivery note exists at all", () => {
    expect(canReceivePod(podGateCodes([]))).toBe(false);
    expect(canReceivePod(podGateCodes([{ type_code: "COMMERCIAL_INVOICE", status: "VERIFIED" }]))).toBe(false);
  });

  it("WES-5 consumption does not regress the gate", () => {
    // The exact lifecycle a POD follows once reconciliation consumes it:
    // VERIFIED -> CONSUMED_AS_EVIDENCE. The gate must hold at BOTH points, or
    // reconciling the dossier would retroactively block POD_RECEIVED.
    const before = podGateCodes([{ type_code: "DELIVERY_NOTE", status: "VERIFIED" }]);
    const after = podGateCodes([{ type_code: "DELIVERY_NOTE", status: "CONSUMED_AS_EVIDENCE" }]);
    expect(canReceivePod(before)).toBe(true);
    expect(canReceivePod(after)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("the engine evidence checker accepts the same statuses", () => {
  it("treats VERIFIED, CONSUMED_AS_EVIDENCE and legacy APPROVED as satisfied", () => {
    for (const status of ["VERIFIED", "CONSUMED_AS_EVIDENCE", "APPROVED"]) {
      expect(podReceived(snapshotWithPod(status)), status).toBe(true);
    }
  });

  it("does not satisfy on an unreviewed or rejected document", () => {
    for (const status of ["UPLOADED", "PENDING_REVIEW", "REJECTED", "EXPIRED", "SUPERSEDED"]) {
      expect(podReceived(snapshotWithPod(status)), status).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("one canonical predicate, not a fourth status list", () => {
  it("isVerified maps the legacy alias and accepts the consumed state", () => {
    expect(canonicalStatus("APPROVED")).toBe("VERIFIED");
    expect(isVerified("VERIFIED")).toBe(true);
    expect(isVerified("APPROVED")).toBe(true);
    expect(isVerified("CONSUMED_AS_EVIDENCE")).toBe(true);
    expect(isVerified("REJECTED")).toBe(false);
  });

  it("both corrected sites call it instead of comparing to a literal", () => {
    const transport = code("lib/transport/actions.ts");
    const fn = transport.slice(
      transport.indexOf("async function approvedDocCodes"),
      transport.indexOf("async function customsGate"),
    );
    expect(fn).toContain("isVerified(d.status)");
    expect(fn).not.toContain('d.status === "APPROVED"');

    const evidence = code("lib/process/engine/evidence.ts");
    const approvedDoc = evidence.slice(
      evidence.indexOf("function approvedDoc"),
      evidence.indexOf("function awaitingReview"),
    );
    expect(approvedDoc).toContain("isVerified(d.status)");
    expect(approvedDoc).not.toContain('d.status === "APPROVED"');
  });

  it("changes nothing else — no transport state, doctrine or reconciliation edit", () => {
    // The transport state machine and the document doctrine are untouched.
    expect(code("lib/transport/status.ts")).toContain('POD_RECEIVED: []');
    expect(code("lib/documents/doctrine.ts")).toContain('APPROVED: "VERIFIED"');
    // awaitingReview / rejectedDoc keep their own vocabularies.
    const evidence = code("lib/process/engine/evidence.ts");
    expect(evidence).toContain('d.status === "UPLOADED" || d.status === "PENDING_REVIEW"');
    expect(evidence).toContain('d.status === "REJECTED" || d.status === "EXPIRED"');
  });
});

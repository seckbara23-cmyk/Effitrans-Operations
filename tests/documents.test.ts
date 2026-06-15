import { describe, it, expect } from "vitest";
import { validateDocumentInput, MAX_DOCUMENT_BYTES } from "@/lib/documents/validate";
import { classifyExpiry } from "@/lib/documents/expiry";
import { canTransition, canReview, canSubmit, isDocumentStatus } from "@/lib/documents/status";

describe("validateDocumentInput", () => {
  const ok = { typeHasValidity: false, sizeBytes: 1000, mimeType: "application/pdf" as string | null };

  it("accepts a valid pdf within limits", () => {
    expect(validateDocumentInput(ok)).toBeNull();
  });
  it("rejects empty / oversized files", () => {
    expect(validateDocumentInput({ ...ok, sizeBytes: 0 })).toBe("file_required");
    expect(validateDocumentInput({ ...ok, sizeBytes: MAX_DOCUMENT_BYTES + 1 })).toBe("file_too_large");
  });
  it("rejects a disallowed MIME type", () => {
    expect(validateDocumentInput({ ...ok, mimeType: "application/x-msdownload" })).toBe("invalid_mime");
  });
  it("requires an expiry date when the type carries validity", () => {
    expect(validateDocumentInput({ ...ok, typeHasValidity: true })).toBe("expiry_required");
    expect(validateDocumentInput({ ...ok, typeHasValidity: true, expiryDate: "2027-01-01" })).toBeNull();
  });
  it("rejects an unparseable expiry date", () => {
    expect(validateDocumentInput({ ...ok, expiryDate: "nope" })).toBe("invalid_expiry_date");
  });
});

describe("classifyExpiry", () => {
  const NOW = new Date("2026-06-15T12:00:00Z");
  it("none when no date / unparseable", () => {
    expect(classifyExpiry(null, NOW)).toBe("none");
    expect(classifyExpiry("bad", NOW)).toBe("none");
  });
  it("expired before today, expiring within lead window, valid beyond", () => {
    expect(classifyExpiry("2026-06-14", NOW)).toBe("expired");
    expect(classifyExpiry("2026-06-15", NOW)).toBe("expiring"); // today
    expect(classifyExpiry("2026-07-10", NOW)).toBe("expiring"); // within 30d
    expect(classifyExpiry("2026-12-01", NOW)).toBe("valid");
  });
});

describe("document state machine", () => {
  it("uploaded can be submitted, reviewed; terminal states cannot", () => {
    expect(canSubmit("UPLOADED")).toBe(true);
    expect(canSubmit("PENDING_REVIEW")).toBe(false);
    expect(canReview("UPLOADED")).toBe(true);
    expect(canReview("PENDING_REVIEW")).toBe(true);
    expect(canReview("APPROVED")).toBe(false);
    expect(canReview("REJECTED")).toBe(false);
  });
  it("valid transitions only", () => {
    expect(canTransition("UPLOADED", "PENDING_REVIEW")).toBe(true);
    expect(canTransition("PENDING_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("PENDING_REVIEW", "REJECTED")).toBe(true);
    expect(canTransition("APPROVED", "REJECTED")).toBe(false);
    expect(canTransition("REJECTED", "PENDING_REVIEW")).toBe(false);
  });
  it("isDocumentStatus guards", () => {
    expect(isDocumentStatus("APPROVED")).toBe(true);
    expect(isDocumentStatus("ARCHIVED")).toBe(false);
  });
});

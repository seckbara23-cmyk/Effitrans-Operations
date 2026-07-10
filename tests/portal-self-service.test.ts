import { describe, it, expect } from "vitest";
import {
  isCustomerUploadableType,
  isValidContactDepartment,
  validateContactMessage,
  requestUpdateCooldownMs,
  latestDocPerType,
  buildSelfServiceActions,
  CUSTOMER_UPLOADABLE_TYPES,
  PAYMENT_PROOF_TYPE,
  REQUEST_UPDATE_WINDOW_MS,
  type DocRow,
} from "@/lib/portal/self-service";

const NOW = new Date("2026-07-10T12:00:00.000Z");

const doc = (over: Partial<DocRow>): DocRow => ({
  id: "d1",
  type_code: "COMMERCIAL_INVOICE",
  status: "PENDING_REVIEW",
  review_note: null,
  version: 1,
  created_at: "2026-07-01T00:00:00.000Z",
  ...over,
});

// ----------------------------------------------------------- uploadable types
describe("isCustomerUploadableType — allow-list ∪ required, never inactive", () => {
  it("accepts allow-listed active types", () => {
    for (const code of CUSTOMER_UPLOADABLE_TYPES) {
      expect(isCustomerUploadableType({ code, active: true, requiredForFile: false })).toBe(true);
    }
  });
  it("accepts a non-listed type ONLY when required for the file", () => {
    expect(isCustomerUploadableType({ code: "CUSTOMS_DECLARATION", active: true, requiredForFile: false })).toBe(false);
    expect(isCustomerUploadableType({ code: "CUSTOMS_DECLARATION", active: true, requiredForFile: true })).toBe(true);
  });
  it("never accepts an inactive type, even if allow-listed or required", () => {
    expect(isCustomerUploadableType({ code: "COMMERCIAL_INVOICE", active: false, requiredForFile: true })).toBe(false);
  });
  it("payment proof type is customer-uploadable", () => {
    expect(CUSTOMER_UPLOADABLE_TYPES).toContain(PAYMENT_PROOF_TYPE);
  });
});

// -------------------------------------------------------------------- contact
describe("contact validation", () => {
  it("validates department against the fixed allow-list", () => {
    expect(isValidContactDepartment("customs")).toBe(true);
    expect(isValidContactDepartment("general")).toBe(true);
    expect(isValidContactDepartment("ceo")).toBe(false);
    expect(isValidContactDepartment("")).toBe(false);
  });
  it("requires a non-trivial message and caps the length", () => {
    expect(validateContactMessage("")).toBe("message_required");
    expect(validateContactMessage("  hi ")).toBe("message_required"); // < 5 chars trimmed
    expect(validateContactMessage("Bonjour, où en est mon dossier ?")).toBeNull();
    expect(validateContactMessage("x".repeat(2001))).toBe("message_too_long");
  });
});

// ------------------------------------------------------------- rate limit (F4)
describe("requestUpdateCooldownMs — 1 per 12h", () => {
  it("allows when never requested", () => {
    expect(requestUpdateCooldownMs(null, NOW)).toBe(0);
  });
  it("blocks within the window and reports remaining time", () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    const remaining = requestUpdateCooldownMs(oneHourAgo, NOW);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBe(REQUEST_UPDATE_WINDOW_MS - 60 * 60 * 1000);
  });
  it("allows again exactly at the window boundary", () => {
    const twelveHoursAgo = new Date(NOW.getTime() - REQUEST_UPDATE_WINDOW_MS).toISOString();
    expect(requestUpdateCooldownMs(twelveHoursAgo, NOW)).toBe(0);
  });
  it("treats an unparseable timestamp as allowed (fail open on bad data, not a crash)", () => {
    expect(requestUpdateCooldownMs("not-a-date", NOW)).toBe(0);
  });
});

// ---------------------------------------------------------- latest doc per type
describe("latestDocPerType — highest version wins, newest breaks ties", () => {
  it("picks the newest version per type", () => {
    const latest = latestDocPerType([
      doc({ id: "old", type_code: "COMMERCIAL_INVOICE", version: 1, status: "REJECTED" }),
      doc({ id: "new", type_code: "COMMERCIAL_INVOICE", version: 2, status: "PENDING_REVIEW" }),
    ]);
    expect(latest.get("COMMERCIAL_INVOICE")?.id).toBe("new");
    expect(latest.get("COMMERCIAL_INVOICE")?.status).toBe("PENDING_REVIEW");
  });
  it("breaks version ties by created_at", () => {
    const latest = latestDocPerType([
      doc({ id: "a", version: 1, created_at: "2026-07-01T00:00:00.000Z" }),
      doc({ id: "b", version: 1, created_at: "2026-07-05T00:00:00.000Z" }),
    ]);
    expect(latest.get("COMMERCIAL_INVOICE")?.id).toBe("b");
  });
});

// ------------------------------------------------------ self-service actions (F8)
describe("buildSelfServiceActions", () => {
  const labelByCode = new Map([
    ["COMMERCIAL_INVOICE", "Facture commerciale"],
    ["PACKING_LIST", "Liste de colisage"],
    ["CERTIFICATE_OF_ORIGIN", "Certificat d'origine"],
  ]);

  it("surfaces rejected docs to replace (latest version) with the reason", () => {
    const res = buildSelfServiceActions({
      docs: [
        doc({ id: "old", type_code: "COMMERCIAL_INVOICE", version: 1, status: "REJECTED", review_note: "Illisible" }),
        doc({ id: "rej", type_code: "COMMERCIAL_INVOICE", version: 2, status: "REJECTED", review_note: "Montant incorrect" }),
      ],
      requiredCodes: ["COMMERCIAL_INVOICE"],
      labelByCode,
      uploadableActiveTypes: [],
      invoices: [],
    });
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]).toMatchObject({ docId: "rej", code: "COMMERCIAL_INVOICE", reason: "Montant incorrect" });
    // A rejected required doc is a REPLACE, never also listed as "missing".
    expect(res.missingRequired).toHaveLength(0);
  });

  it("lists required types with no document as missing (upload), not rejected", () => {
    const res = buildSelfServiceActions({
      docs: [doc({ type_code: "COMMERCIAL_INVOICE", status: "APPROVED" })],
      requiredCodes: ["COMMERCIAL_INVOICE", "PACKING_LIST", "CERTIFICATE_OF_ORIGIN"],
      labelByCode,
      uploadableActiveTypes: [],
      invoices: [],
    });
    expect(res.missingRequired.map((m) => m.code).sort()).toEqual(["CERTIFICATE_OF_ORIGIN", "PACKING_LIST"]);
    expect(res.rejected).toHaveLength(0);
  });

  it("an approved / pending required doc is neither missing nor rejected", () => {
    const res = buildSelfServiceActions({
      docs: [
        doc({ type_code: "COMMERCIAL_INVOICE", status: "APPROVED" }),
        doc({ type_code: "PACKING_LIST", status: "PENDING_REVIEW" }),
      ],
      requiredCodes: ["COMMERCIAL_INVOICE", "PACKING_LIST"],
      labelByCode,
      uploadableActiveTypes: [],
      invoices: [],
    });
    expect(res.missingRequired).toHaveLength(0);
    expect(res.rejected).toHaveLength(0);
  });

  it("flags an unpaid invoice for the payment-proof prompt", () => {
    const base = { docs: [], requiredCodes: [], labelByCode, uploadableActiveTypes: [] };
    expect(buildSelfServiceActions({ ...base, invoices: [{ status: "ISSUED", balance: 500 }] }).hasUnpaidInvoice).toBe(true);
    expect(buildSelfServiceActions({ ...base, invoices: [{ status: "PARTIALLY_PAID", balance: 100 }] }).hasUnpaidInvoice).toBe(true);
    expect(buildSelfServiceActions({ ...base, invoices: [{ status: "PAID", balance: 0 }] }).hasUnpaidInvoice).toBe(false);
    expect(buildSelfServiceActions({ ...base, invoices: [{ status: "ISSUED", balance: 0 }] }).hasUnpaidInvoice).toBe(false);
  });

  it("passes through the uploadable type picker", () => {
    const res = buildSelfServiceActions({
      docs: [],
      requiredCodes: [],
      labelByCode,
      uploadableActiveTypes: [{ code: "COMMERCIAL_INVOICE", label: "Facture commerciale" }],
      invoices: [],
    });
    expect(res.uploadableTypes).toEqual([{ code: "COMMERCIAL_INVOICE", label: "Facture commerciale" }]);
  });
});

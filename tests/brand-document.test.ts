/**
 * DBC-4 — corporate document platform: shared model, template registry, PDF (reused
 * engine) + DOCX (OOXML) renderers, brand injection, readiness, escaping, security, audit.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveComplianceCopy } from "@/lib/brand/model";
import { buildDocumentModel, documentReadiness, documentTotals, lineTotal, hexToRgb, isDocumentType, type DocumentInput } from "@/lib/brand/document/model";
import { TEMPLATE_REGISTRY, TEMPLATE_LIST } from "@/lib/brand/document/registry";
import { renderDocumentPdf } from "@/lib/brand/document/pdf";
import { renderDocumentDocx } from "@/lib/brand/document/docx";
import { buildDocx } from "@/lib/brand/docx/ooxml";
import { zipStore } from "@/lib/brand/docx/zip";
import { AuditActions } from "@/lib/audit/events";
import type { BrandProfile, MembershipView } from "@/lib/brand/server/service";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const WB = "https://whistleblowersoftware.com/secure/doc";
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

function profile(over: Partial<BrandProfile> = {}): BrandProfile {
  return {
    colorGreen: "#0A7D3B", colorGold: "#C8A24B", colorAnthracite: "#333F48",
    fontHeading: "Montserrat", fontBody: "Open Sans", fontEmailFallback: "Calibri",
    slogan: "Performance in Motion", valueProposition: "Integrated Logistics",
    address: "Rue X, Dakar", legalIdentifiers: "RC 12345", websiteUrl: "https://www.effitrans.com", linkedinUrl: null,
    whistleblowerUrl: WB, compliance: resolveComplianceCopy({}), ...over,
  };
}
function membership(over: Partial<MembershipView> = {}): MembershipView {
  return { id: "m1", organizationName: "WCA First", membershipId: "93972", officialUrl: null, status: "active", validFrom: null, expiresAt: null, displayOrder: 0, logoAssetId: null, assetUseNotes: null, ...over };
}
function model(type: DocumentInput["type"], over: Partial<DocumentInput> = {}) {
  const doc: DocumentInput = {
    type, title: "Devis Effitrans", number: "Q-001", date: "2026-07-16", reference: "REF-9",
    client: { name: "Client SARL", address: "Dakar" },
    paragraphs: ["Madame, Monsieur,", "Veuillez trouver ci-joint notre offre."],
    lines: [{ description: "Transit maritime", quantity: 2, unitPrice: 150000 }],
    currency: "XOF",
    sections: [{ heading: "Contexte", text: "Notre proposition." }],
    ...over,
  };
  return buildDocumentModel({ doc, companyName: "Effitrans", profile: profile(), memberships: [membership(), membership({ displayOrder: 1, organizationName: "FIATA" })], signature: { name: "A. NIANG", title: "CEO", email: "abdoul@effitrans.com", phone: "+221763565859" }, complianceEnabled: true });
}

// ---------------------------------------------------------------- registry + model ----

describe("template registry + shared model", () => {
  it("has exactly the four active types, extensibly shaped", () => {
    expect(TEMPLATE_LIST.map((t) => t.type).sort()).toEqual(["INVOICE", "LETTERHEAD", "PROPOSAL", "QUOTATION"]);
    expect(TEMPLATE_REGISTRY.QUOTATION.shape).toBe("line_items");
    expect(TEMPLATE_REGISTRY.INVOICE.allowsSignature).toBe(false);
    expect(isDocumentType("QUOTATION")).toBe(true);
    expect(isDocumentType("POSTER")).toBe(false);
  });
  it("readiness gates on the visible brand identity (green + address)", () => {
    expect(documentReadiness(profile()).ready).toBe(true);
    expect(documentReadiness(profile({ colorGreen: null, address: null })).missing).toEqual(["Couleur verte officielle", "Adresse de l'entreprise"]);
  });
  it("totals + hex are deterministic", () => {
    expect(lineTotal({ description: "x", quantity: 3, unitPrice: 100 })).toBe(300);
    expect(documentTotals([{ description: "a", quantity: 2, unitPrice: 50 }, { description: "b", quantity: 1, unitPrice: 25 }]).subtotal).toBe(125);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ffffff")).toEqual([1, 1, 1]);
  });
});

describe("brand injection comes from the Brand Center only", () => {
  const m = model("QUOTATION");
  it("carries brand colours/address/footer/memberships/compliance/sustainability", () => {
    expect(m.brand.companyName).toBe("Effitrans");
    expect(m.brand.green).toBe("#0A7D3B");
    expect(m.brand.address).toBe("Rue X, Dakar");
    expect(m.brand.footer).toContain("Integrated Logistics");
    expect(m.brand.memberships).toEqual(["WCA First", "FIATA"]); // active, ordered
    expect(m.brand.compliance?.buttonLabel).toBe("Report Confidentially");
  });
  it("compliance is null when disabled", () => {
    const off = buildDocumentModel({ doc: { type: "LETTERHEAD", title: "t", date: "d" }, companyName: "E", profile: profile(), memberships: [], signature: null, complianceEnabled: false });
    expect(off.brand.compliance).toBeNull();
  });
});

// ---------------------------------------------------------------- PDF (reused engine) ----

describe("PDF renderer reuses the existing engine and injects branding", () => {
  it("produces a valid PDF for all four types", () => {
    for (const t of ["LETTERHEAD", "QUOTATION", "INVOICE", "PROPOSAL"] as const) {
      const bytes = renderDocumentPdf(model(t));
      expect(latin1(bytes).startsWith("%PDF")).toBe(true);
      expect(bytes.length).toBeGreaterThan(400);
    }
  });
  it("the reused renderer imports ReportLayout — no second PDF library", () => {
    const pdf = read("../lib/brand/document/pdf.ts");
    expect(pdf).toContain('from "@/lib/reports/templates"');
    expect(pdf).toContain("new ReportLayout(");
  });
  it("renders the company + memberships but NEVER the raw whistleblower URL", () => {
    const s = latin1(renderDocumentPdf(model("QUOTATION")));
    expect(s).toContain("Effitrans");
    expect(s).not.toContain(WB);
    expect(s).not.toContain("whistleblowersoftware");
  });
});

// ---------------------------------------------------------------- DOCX (OOXML) ----

describe("DOCX renderer builds a valid, editable OOXML file (not HTML)", () => {
  it("is a ZIP with the required OOXML parts", () => {
    const bytes = renderDocumentDocx(model("QUOTATION"));
    const s = latin1(bytes);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(s).toContain("[Content_Types].xml");
    expect(s).toContain("word/document.xml");
    expect(s).toContain("<w:document");
    expect(s).not.toContain("<html"); // proper OOXML, not HTML
  });
  it("XML-escapes injected markup (no injection)", () => {
    const bytes = renderDocumentDocx(buildDocumentModel({ doc: { type: "LETTERHEAD", title: "<script>&\"x\"", date: "d", paragraphs: ["<b>evil</b> & <i>x</i>"] }, companyName: "A<B", profile: profile(), memberships: [], signature: null, complianceEnabled: true }));
    const s = latin1(bytes);
    expect(s).toContain("&lt;script&gt;");
    expect(s).toContain("A&lt;B");
    expect(s).not.toContain("<script>");
  });
  it("never emits the raw whistleblower URL", () => {
    expect(latin1(renderDocumentDocx(model("PROPOSAL")))).not.toContain(WB);
  });
  it("the ZIP writer produces parseable stored entries (CRC + central dir)", () => {
    const z = zipStore([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
    const s = latin1(z);
    expect(z[0]).toBe(0x50); expect(z[1]).toBe(0x4b);
    expect(s).toContain("a.txt");
    expect(s).toContain("hello"); // stored (uncompressed) → verbatim
    expect(s.slice(-22, -18)).toContain("PK"); // EOCD signature present near the end
  });
});

// ---------------------------------------------------------------- server action ----

describe("generation is server-side, gated, safely audited", () => {
  const actions = read("../lib/brand/server/document-actions.ts");
  it("gates on admin:config:manage (no new permission) and refuses incomplete branding", () => {
    expect(actions).toContain('assertPermission("admin:config:manage")');
    expect(actions).toContain("documentReadiness(core.profile)");
    expect(actions).toContain("ready: false, missing: readiness.missing");
  });
  it("resolves branding + signature from authoritative sources (no duplication) and renders server-side", () => {
    expect(actions).toContain("readBrandCore(admin.tenantId)");
    expect(actions).toContain("resolveSignature(");
    expect(actions).toContain("renderDocumentPdf(model)");
    expect(actions).toContain("renderDocumentDocx(model)");
  });
  it("the signature block reuses employee identity, never re-stores it", () => {
    expect(actions).toContain('.from("app_user")');
    expect(actions).toContain("u.tenant_id !== tenantId");
  });
  it("audits type/format only — never the body, prices, or line items", () => {
    const audits = code("../lib/brand/server/document-actions.ts").split("writeAudit(").slice(1).map((s) => s.slice(0, s.indexOf("});")));
    for (const a of audits) for (const bad of ["paragraphs", "lines", "unitPrice", "client", "body", "base64"]) expect(a, bad).not.toContain(bad);
    expect(AuditActions.BRAND_DOCUMENT_GENERATED).toBe("brand.document.generated");
  });
});

// ---------------------------------------------------------------- UI ----

describe("studio + overview: no authority, documents surfaced", () => {
  it("the studio holds no admin client / service role and renders server output", () => {
    for (const forbidden of ["getAdminSupabaseClient", "service_role", "readBrandCore", "renderDocumentPdf"]) {
      expect(code("../components/brand/document-studio.tsx"), forbidden).not.toContain(forbidden);
    }
    expect(read("../components/brand/document-studio.tsx")).toContain("generateCorporateDocument(");
  });
  it("the Brand Center overview now surfaces Documents (its phase shipped)", () => {
    expect(read("../app/brand-center/page.tsx")).toContain("/brand-center/documents");
  });
});

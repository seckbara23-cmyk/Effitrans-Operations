/**
 * Phase 7.4B — local searchable-PDF text extraction. Pure logic (assessment / FR-EN
 * classification / page provenance) exercised directly; the server-only parser adapter and the
 * extract action verified structurally. ENTIRELY LOCAL: no OCR, no LLM, no external call. A
 * scanned / image-only PDF returns OCR_REQUIRED. Only the four apply-target fields ever reach
 * an operational record, and only through the existing domain services.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { assessExtractedPdf, PDF_LIMITS } from "@/lib/docintel/pdf/assess";
import { classifyText, detectLanguage } from "@/lib/docintel/classify-text";
import { deterministicExtractPages } from "@/lib/docintel/extract";
import { docIntelProviders } from "@/lib/docintel/provider";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("PDF assessment: limits + searchable-vs-scanned (pure)", () => {
  it("rejects too many pages / oversize bytes as TOO_LARGE", () => {
    expect(assessExtractedPdf({ pages: ["ok text here"], pageCount: PDF_LIMITS.MAX_PAGES + 1 })).toEqual({ ok: false, code: "TOO_LARGE" });
    expect(assessExtractedPdf({ pages: ["ok text here that is long enough"], pageCount: 1, byteSize: PDF_LIMITS.MAX_BYTES + 1 })).toEqual({ ok: false, code: "TOO_LARGE" });
  });
  it("a PDF with no text layer (scanned/image) is OCR_REQUIRED — never fabricated text", () => {
    expect(assessExtractedPdf({ pages: [], pageCount: 3 })).toEqual({ ok: false, code: "OCR_REQUIRED" });
    expect(assessExtractedPdf({ pages: ["   ", "\n\t \f"], pageCount: 2 })).toEqual({ ok: false, code: "OCR_REQUIRED" });
  });
  it("a searchable PDF yields page-preserving bounded text", () => {
    const r = assessExtractedPdf({ pages: ["Page one has real text.", "Page two also."], pageCount: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.pages).toHaveLength(2); expect(r.pageCount).toBe(2); expect(r.truncated).toBe(false); }
  });
  it("truncates (never silently drops) beyond the total-character cap, preserving boundaries", () => {
    const r = assessExtractedPdf({ pages: ["a".repeat(150_000), "b".repeat(150_000)], pageCount: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.truncated).toBe(true); expect(r.charCount).toBe(PDF_LIMITS.MAX_TEXT_CHARS); expect(r.pages.length).toBe(2); }
  });
});

describe("deterministic FR/EN classification (a suggestion; never HIGH)", () => {
  it("classifies BL / AWB / invoice in English and French", () => {
    expect(classifyText("BILL OF LADING — PORT OF LOADING Dakar, consignee ACME").predictedClass).toBe("BILL_OF_LADING");
    expect(classifyText("CONNAISSEMENT maritime — port de chargement, navire MV Test").predictedClass).toBe("BILL_OF_LADING");
    expect(classifyText("AIR WAYBILL master awb 020, flight AF718, IATA").predictedClass).toBe("AIR_WAYBILL");
    expect(classifyText("COMMERCIAL INVOICE incoterm FOB, unit price, total amount 1000").predictedClass).toBe("COMMERCIAL_INVOICE");
  });
  it("confidence tops out at MEDIUM; a single hint is LOW; nothing matched is UNKNOWN", () => {
    const bl = classifyText("BILL OF LADING PORT OF LOADING consignee");
    expect(bl.confidence).toBe("MEDIUM");
    expect(["HIGH"]).not.toContain(bl.confidence);
    expect(classifyText("vessel").confidence).toBe("LOW");
    expect(classifyText("hello world 12345 lorem")).toMatchObject({ predictedClass: "UNKNOWN", confidence: "UNKNOWN", topScore: 0 });
  });
  it("detects document language from marker density (never assumed)", () => {
    expect(detectLanguage("le navire transporte la marchandise, numero du connaissement, poids brut, transporteur")).toBe("FR");
    expect(detectLanguage("the vessel carries the goods, invoice number and carrier, weight of cargo")).toBe("EN");
    expect(detectLanguage("x1 y2 z3")).toBe("UNKNOWN");
  });
});

describe("page-aware extraction preserves provenance", () => {
  it("records the page a field was found on; first occurrence wins", () => {
    const onP2 = deterministicExtractPages("BILL_OF_LADING", ["intro, nothing here", "Conteneur: CSQU3054383"]);
    const cont = onP2.find((c) => c.fieldKey === "container_numbers");
    expect(cont?.page).toBe(2);
    expect(cont?.normalizedValue).toBe("CSQU3054383");
    const dup = deterministicExtractPages("BILL_OF_LADING", ["CSQU3054383", "CSQU3054384"]);
    const first = dup.find((c) => c.fieldKey === "container_numbers");
    expect(first?.page).toBe(1);
    expect(first?.displayedValue).toBe("CSQU3054383");
  });
});

describe("providers: local searchable-PDF text is now configured", () => {
  it("local_pdf_text is configured; OCR/LLM remain unsupported", () => {
    const p = docIntelProviders();
    expect(p.find((x) => x.code === "local_pdf_text")?.status).toBe("configured");
    expect(p.find((x) => x.code === "ocr")?.status).toBe("unsupported");
    expect(p.find((x) => x.code === "llm")?.status).toBe("unsupported");
  });
});

// ---------------------------------------------------------------- structural ----
describe("the parser adapter is server-only, local, and library-isolated", () => {
  const src = read("../lib/docintel/pdf/parser.ts");
  it("declares server-only and imports pdf-parse ONLY via a dynamic inner import", () => {
    expect(src).toContain('import "server-only"');
    expect(src).toContain('await import("pdf-parse/lib/pdf-parse.js")');
  });
  it("performs no network / external call and enforces a timeout + size limits", () => {
    expect(src).not.toMatch(/\b(openai|anthropic|tesseract|textract|axios|node-fetch)\b|\bfetch\s*\(/i);
    expect(src).toContain("TIMEOUT");
    expect(src).toContain("PDF_LIMITS.MAX_BYTES");
  });
  it("next.config keeps pdf-parse external to the bundle", () => {
    const cfg = read("../next.config.mjs");
    expect(cfg).toContain("serverComponentsExternalPackages");
    expect(cfg).toContain("pdf-parse");
  });
});

describe("extractSearchablePdf action: local, safe, and routed", () => {
  const src = code("../lib/docintel/actions.ts");
  it("validates file/version/checksum and parses locally", () => {
    expect(src).toContain("export async function extractSearchablePdf");
    expect(src).toContain("downloadObject(");
    expect(src).toContain("createHash(");
    expect(src).toContain("parseSearchablePdf(");
    expect(src).toContain('doc.version !== job.document_version'); // stale-source guard
  });
  it("classifies deterministically and stamps the local provider", () => {
    expect(src).toContain("classifyText(");
    expect(src).toContain('provider_code: "local_pdf_text"');
    expect(src).toContain('extraction_method: "pdf_text_layer"');
  });
  it("a scanned PDF fails with OCR_REQUIRED (via the bounded failJob path)", () => {
    expect(src).toContain("failJob(admin, user, job, parsed.code)");
  });
  it("still applies ONLY through the domain services — no free-form operational write", () => {
    expect(src).toContain("updateBookingBl(");
    expect(src).toContain("updateAwb(");
    expect(src).not.toMatch(/from\("shipment"\)\s*\.update/);
    expect(src).not.toMatch(/from\("customs_record"\)\s*\.update/);
    expect(src).not.toMatch(/from\("air_awb"\)\s*\.update/);
  });
});

describe("migration 7.4B is additive and honest", () => {
  const mig = read("../supabase/migrations/20260716000008_document_intelligence_pdf.sql");
  it("adds OCR_REQUIRED to failure_category; no new table, permission, or RLS", () => {
    expect(mig).toContain("OCR_REQUIRED");
    expect(mig).toContain("failure_category");
    expect(mig).not.toMatch(/create table/i);
    expect(mig).not.toMatch(/insert into public\.permission/i);
    expect(mig).not.toMatch(/create policy/i);
  });
});

describe("the review studio wires PDF extraction without shipping a secret", () => {
  const rs = read("../components/docintel/review-studio.tsx");
  it("offers PDF extraction + surfaces OCR_REQUIRED, and ships no service role", () => {
    expect(rs).toContain("extractSearchablePdf(");
    expect(rs).toContain("OCR_REQUIRED");
    expect(rs).toContain('"use client"');
    expect(rs).not.toMatch(/service_role/i);
    expect(rs.toLowerCase()).not.toContain("getadminsupabaseclient");
  });
});

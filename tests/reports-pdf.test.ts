import { describe, it, expect } from "vitest";
import { PdfDoc, textWidth } from "@/lib/reports/pdf";
import { fmtNumber, ReportLayout } from "@/lib/reports/templates";
import { buildReportPdf } from "@/lib/reports/report-pdf";
import { buildExecutivePdf } from "@/lib/reports/executive-pdf";
import type { ReportType } from "@/lib/bi/reports";
import { BI, CT, latin1 } from "./fixtures/report-data";

const META = { title: "Rapport Revenus", dateRange: "Du 2026-01-01 au 2026-03-31", generatedAt: "2026-07-09 10:00 UTC", generatedBy: "ops@effitrans.sn" };

/** Structural checks that the bytes are a valid, self-consistent PDF. */
function assertValidPdf(bytes: Uint8Array): string {
  const s = latin1(bytes);
  expect(s.startsWith("%PDF-1.4")).toBe(true);
  expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  expect(s).toContain("/Type /Catalog");
  // startxref must point at the "xref" keyword (byte-accurate offset table).
  const m = s.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
  expect(m).not.toBeNull();
  const xrefOff = Number(m![1]);
  expect(s.slice(xrefOff, xrefOff + 4)).toBe("xref");
  // EVERY in-use xref entry offset must land exactly on "<objNum> 0 obj".
  const lines = s.slice(xrefOff).split("\n");
  const count = Number(lines[1].split(" ")[1]);
  for (let i = 2; i < 2 + count; i++) {
    const line = lines[i] ?? "";
    if (line.includes("65535 f")) continue;
    const off = Number(line.slice(0, 10));
    const objNum = i - 2; // line[2]=obj0 (free), line[3]=obj1, …
    expect(s.slice(off, off + `${objNum} 0 obj`.length)).toBe(`${objNum} 0 obj`);
  }
  return s;
}

describe("PDF core (lib/reports/pdf)", () => {
  it("Helvetica digit widths are uniform (numbers right-align exactly)", () => {
    expect(textWidth("1", 10)).toBeCloseTo(textWidth("9", 10), 6);
    expect(textWidth("00", 10)).toBeCloseTo(2 * textWidth("0", 10), 6);
  });

  it("produces a valid single/multi-page PDF with the drawn text embedded", () => {
    const doc = new PdfDoc({ size: "A4" });
    doc.text(40, 40, "Bonjour — Éléments (accents) €", { size: 12 });
    doc.addPage();
    doc.text(40, 40, "Page deux", { size: 12 });
    expect(doc.pageCount).toBe(2);
    const s = assertValidPdf(doc.toBytes());
    expect(s).toContain("Page deux");
    expect(s).toContain("/Count 2");
  });

  it("stamps header + footer on every page via ReportLayout", () => {
    const L = new ReportLayout(META, "portrait");
    L.sectionHeader("Test");
    for (let i = 0; i < 120; i++) L.paragraph(`Ligne ${i} de contenu pour forcer la pagination sur plusieurs pages.`);
    const bytes = L.finish();
    const s = assertValidPdf(bytes);
    expect(s).toContain("EFFITRANS OPERATIONS");
    expect(s).toContain("Document confidentiel");
    expect(s).toContain("Page 1 / ");
    expect(L.doc.pageCount).toBeGreaterThan(1);
  });
});

describe("fmtNumber (French formatting)", () => {
  it("groups thousands with spaces and uses a decimal comma", () => {
    expect(fmtNumber(1_234_567)).toBe("1 234 567");
    expect(fmtNumber(-2500.5)).toBe("-2 500,5");
    expect(fmtNumber(0)).toBe("0");
  });
});

describe("standard report PDFs (Deliverable 1)", () => {
  const types: ReportType[] = ["revenue", "clients", "operations", "sla", "finance"];
  it.each(types)("builds a valid PDF for the %s report", (type) => {
    const bytes = buildReportPdf(type, { bi: BI, ct: CT, meta: { ...META, title: `Rapport ${type}` } });
    const s = assertValidPdf(bytes);
    expect(s).toContain("EFFITRANS OPERATIONS");
    expect(s).toContain("Synth"); // "Synthèse" section is present
  });
});

describe("Executive Summary PDF (Deliverable 2)", () => {
  it("builds a valid multi-section executive PDF from bi + ct", () => {
    const bytes = buildExecutivePdf({ bi: BI, ct: CT, meta: { ...META, title: "Rapport exécutif" } });
    const s = assertValidPdf(bytes);
    expect(s).toContain("Synth"); // Synthèse exécutive
    expect(s).toContain("EFFITRANS OPERATIONS");
    expect(bytes.length).toBeGreaterThan(1500);
  });
});

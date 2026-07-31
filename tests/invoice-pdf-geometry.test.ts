/**
 * DEF-R10-05 — invoice PDF GEOMETRY.
 *
 * The original renderer produced a correct document laid out upside-down: it
 * used `y` as a distance from the BOTTOM while `PdfDoc` documents and
 * implements a TOP-LEFT origin (`py = this.height - y`). Half of page 1 was
 * blank and the sections read bottom-to-top.
 *
 * Every gate passed anyway, because `uat2b-invoice-artifact.test.ts` pins
 * determinism, provenance and money formatting and asserts NO coordinate. This
 * file is the missing guard: it reads the emitted content stream and checks
 * where things actually land on the page.
 *
 * The content streams are uncompressed Latin-1 (see lib/reports/pdf.ts:
 * `<< /Length n >> stream … endstream`, no /Filter on page content), so they
 * can be parsed directly — no inflate, no PDF library, no browser.
 */
import { describe, expect, it } from "vitest";
import { renderOfficialInvoice, type InvoiceSnapshot } from "@/lib/finance/invoice-pdf";

/** A4 portrait height in points — the MediaBox this renderer emits. */
const PAGE_H = 841.89;

const SNAP: InvoiceSnapshot = {
  organizationName: "Effitrans SARL",
  organizationAddress: "Dakar, Sénégal",
  organizationIdentifiers: ["NINEA : 000000000"],
  paymentDetails: ["Banque : DEMO", "IBAN : SN00 0000 0000"],
  invoiceNumber: "EFT-INV-2026-00001",
  issueDate: "2026-07-28",
  dueDate: "2026-08-27",
  currency: "XOF",
  customerName: "SENEGAL DISTRIBUTION DEMO SARL",
  fileNumber: "EFT-IMP-2026-00003",
  lines: [
    { description: "Dedouanement", quantity: 1, unitAmount: 500_000, taxRate: 0 },
    { description: "Transport", quantity: 1, unitAmount: 250_000, taxRate: 0 },
  ],
};

type Placed = { text: string; fromTop: number; x: number; page: number };

/** Split the document into page content streams, in page order. */
function pageStreams(bytes: Uint8Array): string[] {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const out: string[] = [];
  const re = /<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

/**
 * Every string drawn, with its distance from the TOP of the page.
 *
 * `PdfDoc.text` emits `1 0 0 1 tx py Tm (literal) Tj` where `py` is PDF
 * bottom-left space, so distance-from-top = pageHeight - py. That conversion is
 * the whole subject of this suite: it is what turns "the renderer thinks it
 * drew at the top" into "the reader sees it at the top".
 */
function placedText(bytes: Uint8Array): Placed[] {
  const out: Placed[] = [];
  pageStreams(bytes).forEach((stream, page) => {
    const re = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \((.*?)\) Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stream)) !== null) {
      out.push({ x: Number(m[1]), fromTop: PAGE_H - Number(m[2]), text: m[3], page });
    }
  });
  return out;
}

const find = (items: Placed[], needle: string): Placed => {
  const hit = items.find((p) => p.text.includes(needle));
  if (!hit) throw new Error(`not drawn anywhere in the document: "${needle}"`);
  return hit;
};

// ---------------------------------------------------------------------------
describe("page 1 is laid out from the top", () => {
  const items = placedText(renderOfficialInvoice(SNAP));
  const page1 = items.filter((p) => p.page === 0);

  it("draws the issuer block in the TOP QUARTER of page 1", () => {
    const issuer = find(page1, "Effitrans SARL");
    expect(issuer.fromTop).toBeLessThan(PAGE_H / 4);
  });

  it("leaves no large blank region above the first content", () => {
    // The topmost thing drawn must sit at the margin, not halfway down the page.
    const topmost = Math.min(...page1.map((p) => p.fromTop));
    expect(topmost).toBeLessThan(60);
  });

  it("puts the title and the invoice number above the totals", () => {
    const title = find(page1, "FACTURE");
    const number = find(page1, "EFT-INV-2026-00001");
    const total = find(page1, "TOTAL");
    expect(title.fromTop).toBeLessThan(total.fromTop);
    expect(number.fromTop).toBeLessThan(total.fromTop);
  });

  it("puts every line item above the totals", () => {
    const total = find(page1, "TOTAL");
    for (const desc of ["Dedouanement", "Transport"]) {
      expect(find(page1, desc).fromTop).toBeLessThan(total.fromTop);
    }
  });

  it("reads top-to-bottom section by section", () => {
    const order = [
      "Effitrans SARL", // issuer
      "Factur", // « Facturé à » (accent is WinAnsi-encoded)
      "SENEGAL DISTRIBUTION DEMO SARL", // customer
      "signation", // « Désignation » — table header
      "Dedouanement", // first line item
      "TOTAL", // totals
      "glement", // « Coordonnées de règlement »
    ].map((needle) => find(page1, needle).fromTop);

    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it("keeps the dossier reference in the upper half, next to the customer", () => {
    const dossier = find(page1, "EFT-IMP-2026-00003");
    expect(dossier.fromTop).toBeLessThan(PAGE_H / 2);
    // Right column: the dossier block is right-aligned, the customer left.
    expect(dossier.x).toBeGreaterThan(find(page1, "SENEGAL DISTRIBUTION DEMO SARL").x);
  });
});

// ---------------------------------------------------------------------------
describe("overflow starts the next page at the top margin", () => {
  const many: InvoiceSnapshot = {
    ...SNAP,
    lines: Array.from({ length: 60 }, (_, i) => ({
      description: `Prestation ${i + 1}`,
      quantity: 1,
      unitAmount: 10_000,
      taxRate: 0,
    })),
  };
  const items = placedText(renderOfficialInvoice(many));

  it("actually breaks onto a second page", () => {
    expect(Math.max(...items.map((p) => p.page))).toBeGreaterThan(0);
  });

  it("restarts page 2 at the top margin, not at the bottom", () => {
    const page2 = items.filter((p) => p.page === 1);
    expect(page2.length).toBeGreaterThan(0);
    expect(Math.min(...page2.map((p) => p.fromTop))).toBeLessThan(60);
  });

  it("never draws below the page bottom on any page", () => {
    for (const p of items) {
      expect(p.fromTop).toBeGreaterThan(0);
      expect(p.fromTop).toBeLessThan(PAGE_H);
    }
  });
});

// ---------------------------------------------------------------------------
describe("the top-down contract is stated where it is used", () => {
  it("never reintroduces a bottom-up cursor", () => {
    // The defect was `let y = 800` + `y -= n`. Both are banned in this renderer;
    // lib/reports/pdf.ts owns the only conversion to bottom-left space.
    const src = renderOfficialInvoice.toString();
    expect(src).not.toMatch(/y\s*-=/);
    expect(src).not.toMatch(/=\s*800\b/);
  });
});

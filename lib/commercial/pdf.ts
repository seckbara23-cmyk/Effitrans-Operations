import "server-only";

/**
 * EC-3B — quotation PDF. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * REUSES the platform's hand-rolled `PdfDoc` engine (lib/reports/pdf.ts). No
 * second renderer, no dependency, no template asset.
 *
 * WHY THE ARTIFACT IS NOT A `public.document` ROW YET — the reuse audit's
 * central finding: `document.file_id` is NOT NULL and
 * `finalize_generated_artifact` takes `p_file_id`, but **a quotation exists
 * before any dossier**. So the immutable-artifact DISCIPLINE is applied here —
 * render once, hash the exact bytes, store privately, record path + hash +
 * renderer version on the quotation — while REGISTRATION into the governed
 * document registry waits for conversion, when a dossier exists (EC-3D). This
 * is the same shape EC-1 used for inbound attachments: evidence-in-waiting,
 * promoted when it has a home.
 *
 * NO TOTAL IS MANDATED AND NO TAX IS INVENTED. The tax block renders only when
 * a line actually carries a rate the tenant entered; with the default rate of
 * zero the document shows a subtotal and nothing else.
 */
import { PdfDoc, textWidth } from "@/lib/reports/pdf";
import {
  quotationTotals, formatAmountMinor, formatQuantityMilli, formatRateBp,
  type QuotationLineLike,
} from "./money";

/** Bumped when the rendered layout changes. Stored with every artifact. */
export const QUOTATION_RENDERER_VERSION = "quotation-pdf@1";

export type QuotationPdfLine = QuotationLineLike & {
  position: number;
  description: string;
};

export type QuotationPdfInput = {
  quotationNumber: string | null;
  version: number;
  issuedOn: string;
  currency: string;
  tenantName: string;
  clientName: string;
  clientAddress?: string | null;
  clientNinea?: string | null;
  subject?: string | null;
  terms?: string | null;
  validityNote?: string | null;
  lines: readonly QuotationPdfLine[];
};

const M = 40;              // page margin
const INK: [number, number, number] = [0.1, 0.12, 0.18];
const MUTED: [number, number, number] = [0.42, 0.45, 0.5];

/** Render one quotation. Deterministic: same input → same bytes → same hash. */
export function renderQuotationPdf(input: QuotationPdfInput): Uint8Array {
  const doc = new PdfDoc({ size: "A4", orientation: "portrait" });
  const right = doc.width - M;
  let y = M;

  // ---- header -------------------------------------------------------------
  doc.text(M, y, input.tenantName, { size: 16, bold: true, color: INK });
  doc.text(right, y, "COTATION", { size: 16, bold: true, color: INK, align: "right" });
  y += 18;
  doc.text(right, y, input.quotationNumber ?? "(non émise)", { size: 10, color: MUTED, align: "right" });
  y += 12;
  doc.text(right, y, `Version ${input.version} · ${input.issuedOn}`, { size: 9, color: MUTED, align: "right" });
  y += 16;
  doc.line(M, y, right, y);
  y += 18;

  // ---- client -------------------------------------------------------------
  doc.text(M, y, "Client", { size: 9, bold: true, color: MUTED });
  y += 12;
  doc.text(M, y, input.clientName, { size: 11, bold: true, color: INK });
  y += 13;
  if (input.clientAddress) { doc.text(M, y, input.clientAddress, { size: 9, color: INK }); y += 11; }
  if (input.clientNinea) { doc.text(M, y, `NINEA : ${input.clientNinea}`, { size: 9, color: MUTED }); y += 11; }
  if (input.subject) { y += 4; doc.text(M, y, `Objet : ${input.subject}`, { size: 10, color: INK }); y += 13; }
  y += 8;

  // ---- lines --------------------------------------------------------------
  const colQty = right - 300;
  const colUnit = right - 200;
  const colTax = right - 90;
  const colTotal = right;

  doc.fillRect(M, y - 3, right - M, 16, [0.95, 0.96, 0.97]);
  doc.text(M + 4, y, "Désignation", { size: 9, bold: true, color: MUTED });
  doc.text(colQty, y, "Qté", { size: 9, bold: true, color: MUTED, align: "right" });
  doc.text(colUnit, y, "P.U.", { size: 9, bold: true, color: MUTED, align: "right" });
  doc.text(colTax, y, "Taxe", { size: 9, bold: true, color: MUTED, align: "right" });
  doc.text(colTotal - 4, y, "Total HT", { size: 9, bold: true, color: MUTED, align: "right" });
  y += 18;

  const totals = quotationTotals(input.lines);

  for (const l of [...input.lines].sort((a, b) => a.position - b.position)) {
    if (y > doc.height - 140) { doc.addPage(); y = M; }
    const sub = Math.round((l.quantityMilli * l.unitAmountMinor) / 1000);
    // Wrap long descriptions rather than letting them collide with the columns.
    const maxW = colQty - M - 12;
    let text = l.description;
    while (textWidth(text, 9) > maxW && text.length > 4) text = text.slice(0, -2);
    if (text !== l.description) text = `${text}…`;

    doc.text(M + 4, y, text, { size: 9, color: INK });
    doc.text(colQty, y, formatQuantityMilli(l.quantityMilli), { size: 9, color: INK, align: "right" });
    doc.text(colUnit, y, formatAmountMinor(l.unitAmountMinor, ""), { size: 9, color: INK, align: "right" });
    // A zero rate prints nothing at all — the platform encodes no tax rule.
    doc.text(colTax, y, l.taxRateBp > 0 ? formatRateBp(l.taxRateBp) : "—", { size: 9, color: MUTED, align: "right" });
    doc.text(colTotal - 4, y, formatAmountMinor(sub, ""), { size: 9, color: INK, align: "right" });
    y += 14;
  }

  y += 6;
  doc.line(colUnit - 20, y, right, y);
  y += 14;

  // ---- totals -------------------------------------------------------------
  doc.text(colTax, y, "Sous-total HT", { size: 9, color: MUTED, align: "right" });
  doc.text(colTotal - 4, y, formatAmountMinor(totals.subtotalMinor, input.currency), { size: 10, bold: true, color: INK, align: "right" });
  y += 15;

  // The tax rows exist ONLY when a tenant entered a rate. No default, no
  // invented cascade, no statutory line.
  if (!totals.taxFree) {
    doc.text(colTax, y, "Taxes", { size: 9, color: MUTED, align: "right" });
    doc.text(colTotal - 4, y, formatAmountMinor(totals.taxMinor, input.currency), { size: 10, color: INK, align: "right" });
    y += 15;
    doc.text(colTax, y, "Total TTC", { size: 10, bold: true, color: MUTED, align: "right" });
    doc.text(colTotal - 4, y, formatAmountMinor(totals.totalMinor, input.currency), { size: 11, bold: true, color: INK, align: "right" });
    y += 18;
  }

  // ---- terms --------------------------------------------------------------
  if (input.terms) {
    y += 10;
    doc.text(M, y, "Conditions", { size: 9, bold: true, color: MUTED });
    y += 12;
    for (const line of wrap(input.terms, 95)) {
      if (y > doc.height - 60) { doc.addPage(); y = M; }
      doc.text(M, y, line, { size: 9, color: INK });
      y += 11;
    }
  }
  if (input.validityNote) {
    y += 8;
    doc.text(M, y, input.validityNote, { size: 8, color: MUTED });
  }

  return doc.toBytes();
}

/** Naive word wrap. Presentation only. */
function wrap(s: string, width: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) { if (cur) out.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

/** Deterministic storage path. Tenant-scoped, versioned, never guessable. */
export function quotationArtifactPath(tenantId: string, quotationId: string, version: number): string {
  return `${tenantId}/quotations/${quotationId}/v${version}.pdf`;
}

export function quotationFileName(number: string | null, version: number): string {
  const base = (number ?? "cotation").replace(/[^A-Za-z0-9._-]/g, "_");
  return `${base}-v${version}.pdf`;
}

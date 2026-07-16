/**
 * Corporate document → PDF (DBC-4). Server + client safe.
 * ---------------------------------------------------------------------------
 * REUSES the existing PDF engine (lib/reports/pdf.ts) via ReportLayout — the SAME
 * ReportBrand header/footer + paragraph/table/totals/sectionHeader helpers the reports use.
 * No second PDF library, no forked branding: the brand colours + names are injected through
 * ReportBrand, exactly as tenant reports already do. The compliance whistleblower URL is
 * NEVER printed as raw text (a PDF has no button — the block shows the label only).
 */
import { ReportLayout, type ReportMeta } from "@/lib/reports/templates";
import { hexToRgb, documentTotals, lineTotal, type CorporateDocumentModel } from "./model";

function money(n: number, currency: string): string {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function renderDocumentPdf(model: CorporateDocumentModel): Uint8Array {
  const b = model.brand;
  const meta: ReportMeta = {
    title: model.meta.title,
    dateRange: [model.meta.number ? `N° ${model.meta.number}` : "", model.meta.date, model.meta.reference ? `Réf. ${model.meta.reference}` : ""].filter(Boolean).join("  ·  "),
    generatedAt: model.meta.date,
    generatedBy: b.companyName,
    brand: {
      header: b.companyName,
      footer: b.footer,
      displayName: b.companyName,
      subtitle: b.slogan ?? undefined,
      primary: hexToRgb(b.green),
      accent: hexToRgb(b.gold ?? b.green),
    },
  };
  const L = new ReportLayout(meta, "portrait");

  // Recipient / client.
  if (model.client) {
    L.sectionHeader("Destinataire");
    L.paragraph(model.client.name, { size: 11 });
    if (model.client.address) L.paragraph(model.client.address);
    L.gap(6);
  }

  // Body by shape.
  if (model.body.paragraphs?.length) {
    for (const p of model.body.paragraphs) L.paragraph(p);
  }
  if (model.body.lines?.length) {
    const currency = model.body.currency ?? "XOF";
    L.sectionHeader("Détail");
    L.table(
      ["Description", "Qté", "P.U.", "Total"],
      model.body.lines.map((l) => [l.description, String(l.quantity), money(l.unitPrice, currency), money(lineTotal(l), currency)]),
      { weights: [6, 1, 2, 2], align: ["left", "right", "right", "right"] },
    );
    L.totals([{ label: "Sous-total", value: money(documentTotals(model.body.lines).subtotal, currency) }]);
    L.gap(6);
  }
  if (model.body.sections?.length) {
    for (const s of model.body.sections) {
      L.sectionHeader(s.heading);
      L.paragraph(s.text);
    }
  }
  if (model.body.notes) {
    L.gap(4);
    L.paragraph(model.body.notes, { size: 9 });
  }

  // Memberships (names — approved logos are image-only; the reused engine has no raster).
  if (b.memberships.length) {
    L.gap(6);
    L.paragraph(`Réseaux : ${b.memberships.join(", ")}`, { size: 9 });
  }

  // Compliance block (label only — never the raw whistleblower URL).
  if (b.compliance) {
    L.gap(6);
    L.sectionHeader(b.compliance.title);
    L.paragraph(`${b.compliance.subtitle} — ${b.compliance.buttonLabel}`, { size: 9 });
  }

  // Sustainability + print statement.
  L.gap(6);
  L.paragraph(b.sustainability, { size: 9 });
  L.paragraph(b.environmentalPrint, { size: 8 });

  // Employee signature block (from the Signature Engine's resolved identity).
  if (model.signature) {
    L.gap(10);
    L.paragraph(model.signature.name, { size: 11 });
    if (model.signature.title) L.paragraph(model.signature.title, { size: 9 });
    const contact = [model.signature.email, model.signature.phone].filter(Boolean).join("  ·  ");
    if (contact) L.paragraph(contact, { size: 9 });
  }

  return L.finish();
}

/**
 * Corporate document → DOCX (DBC-4). PURE.
 * ---------------------------------------------------------------------------
 * Maps the SAME CorporateDocumentModel into OOXML blocks and builds a valid, editable
 * .docx via the hand-rolled OOXML writer — no HTML-to-docx, no second engine, no duplicated
 * branding. The whistleblower URL is never emitted (compliance shows the label only).
 */
import { buildDocx, type DocxBlock } from "@/lib/brand/docx/ooxml";
import { documentTotals, lineTotal, type CorporateDocumentModel } from "./model";

function money(n: number, currency: string): string {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function renderDocumentDocx(model: CorporateDocumentModel): Uint8Array {
  const b = model.brand;
  const blocks: DocxBlock[] = [];

  // Branded header (colour band is a PDF concept; in DOCX the company is a coloured heading).
  blocks.push({ kind: "heading", text: b.companyName, color: b.green });
  if (b.slogan) blocks.push({ kind: "para", text: b.slogan, size: 9, color: b.anthracite });
  blocks.push({ kind: "para", text: model.meta.title, bold: true, size: 14, color: b.anthracite });
  const metaLine = [model.meta.number ? `N° ${model.meta.number}` : "", model.meta.date, model.meta.reference ? `Réf. ${model.meta.reference}` : ""].filter(Boolean).join("  ·  ");
  if (metaLine) blocks.push({ kind: "para", text: metaLine, size: 9 });

  if (model.client) {
    blocks.push({ kind: "heading", text: "Destinataire", color: b.green });
    blocks.push({ kind: "para", text: model.client.name, bold: true });
    if (model.client.address) blocks.push({ kind: "para", text: model.client.address });
  }

  if (model.body.paragraphs?.length) for (const p of model.body.paragraphs) blocks.push({ kind: "para", text: p });

  if (model.body.lines?.length) {
    const currency = model.body.currency ?? "XOF";
    blocks.push({ kind: "heading", text: "Détail", color: b.green });
    blocks.push({
      kind: "table",
      headers: ["Description", "Qté", "P.U.", "Total"],
      rows: model.body.lines.map((l) => [l.description, String(l.quantity), money(l.unitPrice, currency), money(lineTotal(l), currency)]),
    });
    blocks.push({ kind: "para", text: `Sous-total : ${money(documentTotals(model.body.lines).subtotal, currency)}`, bold: true });
  }

  if (model.body.sections?.length) for (const s of model.body.sections) {
    blocks.push({ kind: "heading", text: s.heading, color: b.green });
    blocks.push({ kind: "para", text: s.text });
  }
  if (model.body.notes) blocks.push({ kind: "para", text: model.body.notes, size: 9 });

  if (b.memberships.length) blocks.push({ kind: "para", text: `Réseaux : ${b.memberships.join(", ")}`, size: 9 });
  if (b.compliance) {
    blocks.push({ kind: "heading", text: b.compliance.title, color: b.green });
    blocks.push({ kind: "para", text: `${b.compliance.subtitle} — ${b.compliance.buttonLabel}`, size: 9 });
  }
  blocks.push({ kind: "para", text: b.sustainability, size: 9, color: b.green });
  blocks.push({ kind: "para", text: b.environmentalPrint, size: 8 });
  blocks.push({ kind: "para", text: b.footer, size: 8 });

  if (model.signature) {
    blocks.push({ kind: "para", text: model.signature.name, bold: true, size: 11 });
    if (model.signature.title) blocks.push({ kind: "para", text: model.signature.title, size: 9 });
    const contact = [model.signature.email, model.signature.phone].filter(Boolean).join("  ·  ");
    if (contact) blocks.push({ kind: "para", text: contact, size: 9 });
  }

  return buildDocx(blocks);
}

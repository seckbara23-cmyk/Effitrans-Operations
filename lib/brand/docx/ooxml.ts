/**
 * Minimal OOXML (.docx) builder (DBC-4). PURE.
 * ---------------------------------------------------------------------------
 * Builds a valid, editable WordprocessingML document — a proper document approach (real
 * OOXML), NOT HTML renamed to .docx. Every dynamic value is XML-escaped. Produces the three
 * parts a .docx requires ([Content_Types].xml, _rels/.rels, word/document.xml) and zips them
 * (stored). Colours are applied to headings from the brand palette (hex without '#').
 */
import { zipStore } from "./zip";

export function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export type DocxBlock =
  | { kind: "para"; text: string; bold?: boolean; size?: number; color?: string }
  | { kind: "heading"; text: string; color?: string }
  | { kind: "table"; headers: string[]; rows: string[][] };

function run(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): string {
  const rpr: string[] = [];
  if (opts.bold) rpr.push("<w:b/>");
  if (opts.size) rpr.push(`<w:sz w:val="${opts.size * 2}"/>`);
  if (opts.color) rpr.push(`<w:color w:val="${(opts.color || "").replace(/^#/, "")}"/>`);
  const rprXml = rpr.length ? `<w:rPr>${rpr.join("")}</w:rPr>` : "";
  return `<w:r>${rprXml}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}

function paragraph(block: Extract<DocxBlock, { kind: "para" | "heading" }>): string {
  if (block.kind === "heading") {
    return `<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>${run(block.text, { bold: true, size: 13, color: block.color })}</w:p>`;
  }
  return `<w:p>${run(block.text, { bold: block.bold, size: block.size ?? 10, color: block.color })}</w:p>`;
}

function tableXml(headers: string[], rows: string[][]): string {
  const cell = (t: string, bold = false) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${run(t, { bold, size: 9 })}</w:p></w:tc>`;
  const headerRow = `<w:tr>${headers.map((h) => cell(h, true)).join("")}</w:tr>`;
  const bodyRows = rows.map((r) => `<w:tr>${r.map((c) => cell(c)).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:color="CCCCCC"/>` +
    `<w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:color="CCCCCC"/>` +
    `<w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideV w:val="single" w:sz="4" w:color="CCCCCC"/>` +
    `</w:tblBorders></w:tblPr>${headerRow}${bodyRows}</w:tbl>`;
}

function documentXml(blocks: DocxBlock[]): string {
  const body = blocks
    .map((b) => (b.kind === "table" ? tableXml(b.headers, b.rows) : paragraph(b)))
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

/** Build a valid, editable .docx from content blocks. */
export function buildDocx(blocks: DocxBlock[]): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  return zipStore([
    { name: "[Content_Types].xml", data: enc(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc(RELS) },
    { name: "word/document.xml", data: enc(documentXml(blocks)) },
  ]);
}

/**
 * Minimal XLSX writer (Phase 3.0 / 3.0B) — PURE, dependency-free. Client + server safe.
 * ---------------------------------------------------------------------------
 * Produces a valid .xlsx (OOXML) as a STORED (uncompressed) ZIP — no third-party
 * library, no external integration. Strings are inline; numbers are numeric
 * cells. `toXlsx` writes one sheet; `toXlsxWorkbook` writes many (the Power BI
 * export pack). The ZIP container is the shared ./zip writer. Sufficient for
 * tabular report exports; not a full spreadsheet engine.
 */
import { zip, type ZipEntry } from "./zip";

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function colLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function isNumeric(v: string | number | null): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function sheetXml(headers: string[], rows: (string | number | null)[][]): string {
  const all: (string | number | null)[][] = [headers, ...rows];
  const body = all
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${colLetter(c)}${r + 1}`;
          if (isNumeric(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          const s = v == null ? "" : String(v);
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(s)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
  );
}

/** A single worksheet: a friendly tab name + its header row + data rows. */
export type Sheet = { name: string; headers: string[]; rows: (string | number | null)[][] };

const enc = (s: string) => new TextEncoder().encode(s);

// Excel tab names: ≤ 31 chars, without : \ / ? * [ ] and non-empty.
function safeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

function contentTypes(count: number): string {
  const overrides = Array.from({ length: count }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    overrides +
    `</Types>`
  );
}

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

function workbookXml(names: string[]): string {
  const sheets = names
    .map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRels(count: number): string {
  const rels = Array.from({ length: count }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
  );
}

/** A multi-sheet workbook (Power BI export pack). Each sheet is pure tabular data. */
export function toXlsxWorkbook(sheets: Sheet[]): Uint8Array {
  const list = sheets.length ? sheets : [{ name: "Rapport", headers: [], rows: [] }];
  const names = list.map((s, i) => safeSheetName(s.name, i));
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: enc(contentTypes(list.length)) },
    { name: "_rels/.rels", data: enc(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc(workbookXml(names)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(workbookRels(list.length)) },
  ];
  list.forEach((s, i) => {
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s.headers, s.rows)) });
  });
  return zip(entries);
}

/** Single-sheet .xlsx (unchanged public API — the existing report export). */
export function toXlsx(headers: string[], rows: (string | number | null)[][]): Uint8Array {
  return toXlsxWorkbook([{ name: "Rapport", headers, rows }]);
}

/**
 * Minimal XLSX writer (Phase 3.0) — PURE, dependency-free. Client + server safe.
 * ---------------------------------------------------------------------------
 * Produces a valid single-sheet .xlsx (OOXML) as a STORED (uncompressed) ZIP —
 * no third-party library, no external integration. Strings are inline; numbers
 * are numeric cells. Sufficient for tabular report exports; not a full
 * spreadsheet engine.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

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

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="Rapport" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `</Relationships>`;

type Entry = { name: string; data: Uint8Array };

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/** Build a STORED (uncompressed) ZIP from the parts. */
function zip(entries: Entry[]): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = Array.from(new TextEncoder().encode(e.name));
    const crc = crc32(e.data);
    const size = e.data.length;
    // local file header
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ];
    chunks.push(...local, ...e.data);
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset), ...nameBytes,
    );
    offset += local.length + size;
  }

  const centralOffset = offset;
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(central.length), ...u32(centralOffset), ...u16(0),
  ];
  return Uint8Array.from([...chunks, ...central, ...eocd]);
}

export function toXlsx(headers: string[], rows: (string | number | null)[][]): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  return zip([
    { name: "[Content_Types].xml", data: enc(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc(WORKBOOK) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(WORKBOOK_RELS) },
    { name: "xl/worksheets/sheet1.xml", data: enc(sheetXml(headers, rows)) },
  ]);
}

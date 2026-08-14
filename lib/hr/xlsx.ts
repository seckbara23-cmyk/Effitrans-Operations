/**
 * HR-B3 — minimal XLSX support, hand-rolled. SERVER-ONLY consumers.
 * ---------------------------------------------------------------------------
 * The house already writes OOXML by hand (DBC-4 DOCX, DBC-5 PPTX: ZIP + XML,
 * no dependency); this module extends the same doctrine to the one spreadsheet
 * the HR import journey needs — a downloadable template — and to READING the
 * workbook the operator sends back.
 *
 * WRITER: a one-sheet workbook, inline strings, STORED (uncompressed) zip
 * entries. Deterministic bytes for a given input — no timestamps.
 *
 * READER: end-of-central-directory → central directory → entries, method 0
 * (stored) or 8 (deflate, via node:zlib inflateRawSync — no dependency);
 * shared strings + inline strings + numeric cells of the FIRST worksheet.
 * It parses machine-generated OOXML, not arbitrary XML: Excel, LibreOffice
 * and Google Sheets exports all fit. Anything unreadable throws — the caller
 * turns that into a refusal, never a silent empty import.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

// ----------------------------------------------------------------- crc32 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------- zip writer ----
type ZipEntry = { name: string; data: Uint8Array };

function u16(v: number): number[] { return [v & 0xff, (v >> 8) & 0xff]; }
function u32(v: number): number[] { return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]; }

/** STORED entries only — simple, valid, and Excel-compatible. */
function buildZip(entries: ZipEntry[]): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0;
  const enc = new TextEncoder();

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(name.length), ...u16(0),
    ];
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ...Array.from(name),
    );
    chunks.push(...local, ...Array.from(name), ...Array.from(e.data));
    offset += local.length + name.length + e.data.length;
  }

  const cdStart = offset;
  chunks.push(...central);
  const cdSize = central.length;
  chunks.push(
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(cdStart), ...u16(0),
  );
  return new Uint8Array(chunks);
}

// -------------------------------------------------------------- xml utils ----
const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const unescXml = (s: string) =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function colLetter(i: number): string {
  let s = "";
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ----------------------------------------------------------------- writer ----
/** A one-sheet .xlsx from rows of strings. Row 1 is whatever the caller puts there. */
export function buildXlsx(sheetName: string, rows: readonly (readonly string[])[]): Uint8Array {
  const enc = new TextEncoder();
  const rowsXml = rows
    .map((cells, r) => {
      const cellsXml = cells
        .map((v, c) => `<c r="${colLetter(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`)
        .join("");
      return `<row r="${r + 1}">${cellsXml}</row>`;
    })
    .join("");

  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="${escXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
          `</workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
      ),
    },
  ];
  return buildZip(entries);
}

// ----------------------------------------------------------------- reader ----
function readZipEntries(buf: Uint8Array): Map<string, Uint8Array> {
  // EOCD: scan backwards for 0x06054b50 (comment can pad the tail).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("xlsx: end of central directory not found");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);

  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error("xlsx: bad central directory");
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOff = view.getUint32(ptr + 42, true);
    const name = dec.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    // Local header carries its own (possibly different) name/extra lengths.
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(raw)));
    else throw new Error(`xlsx: unsupported compression method ${method}`);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Parse the FIRST worksheet into rows of strings. Shared strings, inline
 * strings, formula results and plain numbers are all read as text; empty
 * cells become "".
 */
export function parseXlsx(buf: Uint8Array): string[][] {
  const entries = readZipEntries(buf);
  const dec = new TextDecoder();

  const text = (name: string) => {
    const e = entries.get(name);
    return e ? dec.decode(e) : null;
  };

  // Resolve the first sheet's part via the workbook rels; fall back to the
  // conventional path if the rels are absent or unhelpful.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const firstSheet = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb);
    if (firstSheet) {
      const rel = new RegExp(`<Relationship[^>]*Id="${firstSheet[1]}"[^>]*Target="([^"]+)"`).exec(rels);
      if (rel) sheetPath = rel[1].startsWith("/") ? rel[1].slice(1) : `xl/${rel[1].replace(/^\.\//, "")}`;
    }
  }
  const sheet = text(sheetPath) ?? text("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("xlsx: worksheet not found");

  // Shared strings: each <si> may hold one <t> or several (rich runs).
  const shared: string[] = [];
  const ss = text("xl/sharedStrings.xml");
  if (ss) {
    for (const si of ss.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
      const parts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescXml(m[1]));
      shared.push(parts.join(""));
    }
  }

  const rows: string[][] = [];
  for (const rowXml of sheet.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const m of rowXml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const inner = m[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      let value = "";
      if (type === "inlineStr") {
        value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescXml(x[1])).join("");
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          value = type === "s" ? (shared[Number(v)] ?? "") : unescXml(v);
        }
      }
      while (cells.length < idx) cells.push("");
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** PK\x03\x04 — the only reliable cheap discriminator between xlsx and csv. */
export function looksLikeZip(buf: Uint8Array): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

// deflateRawSync is imported to keep the writer/reader symmetric if a future
// template grows past the STORED sweet spot; re-exported for tests.
export const _internals = { crc32, buildZip, readZipEntries, deflateRawSync };

/**
 * Minimal PDF writer (Phase 3.0B) — PURE, dependency-free. Server + client safe.
 * ---------------------------------------------------------------------------
 * Produces a valid PDF 1.4 document directly from data (NO browser, NO
 * screenshots, NO HTML-to-image). Uses the standard Type1 fonts Helvetica /
 * Helvetica-Bold (base-14 — no font embedding needed) with WinAnsiEncoding, so
 * French accents render. Sufficient for corporate tabular/KPI reports; not a
 * general typesetting engine.
 *
 * The higher-level, reusable report components (header, footer, KPI card, table,
 * totals, signature block) live in ./templates and build on this core.
 */

export type RGB = [number, number, number];
export type PageSize = "A4" | "LETTER";
export type Orientation = "portrait" | "landscape";

// Points (1/72 inch).
const SIZES: Record<PageSize, [number, number]> = {
  A4: [595.28, 841.89],
  LETTER: [612, 792],
};

// Helvetica advance widths (per 1000 em) for printable ASCII 0x20–0x7E. Digits
// are all 556, so right-aligned numbers align exactly. Non-ASCII (accents) fall
// back to 556 — close enough for centring/alignment.
const HELV_W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Advance width of `s` at `size` pt (bold is ~4% wider). */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const em = c >= 0x20 && c <= 0x7e ? HELV_W[c - 0x20] : 556;
    w += em;
  }
  return (w / 1000) * size * (bold ? 1.04 : 1);
}

// A tiny Unicode → WinAnsi remap for the punctuation the reports actually use.
const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80, // €
  0x2026: 0x85, // …
  0x2022: 0x95, // •
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201c: 0x93, // “
  0x201d: 0x94, // ”
  0x2013: 0x96, // –
  0x2014: 0x97, // —
};

/** Encode a JS string to WinAnsi bytes with PDF string escaping. */
function pdfLiteral(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i);
    if (code > 0xff) code = WIN_ANSI[code] ?? 0x3f; // '?' for the unmappable
    const ch = String.fromCharCode(code);
    if (ch === "\\" || ch === "(" || ch === ")") out += "\\" + ch;
    else out += ch;
  }
  return out;
}

const F = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0).toString();

export type TextOpts = { size?: number; bold?: boolean; color?: RGB; align?: "left" | "center" | "right" };

/**
 * A single PDF document. Coordinates are TOP-LEFT based (y grows downward) — the
 * class converts to PDF's bottom-left space internally. Build pages, draw, then
 * call toBytes().
 */
export class PdfDoc {
  readonly width: number;
  readonly height: number;
  private pages: string[] = [""];
  private scratch: string | null = null;

  constructor(opts: { size?: PageSize; orientation?: Orientation } = {}) {
    const [w, h] = SIZES[opts.size ?? "A4"];
    if ((opts.orientation ?? "portrait") === "landscape") {
      this.width = h;
      this.height = w;
    } else {
      this.width = w;
      this.height = h;
    }
  }

  /** Number of pages currently in the document. */
  get pageCount(): number {
    return this.pages.length;
  }

  /** Start a new page and make it current. */
  addPage(): void {
    this.pages.push("");
  }

  /** Append an operator string to the active target (scratch or current page). */
  private write(op: string): void {
    if (this.scratch !== null) this.scratch += op;
    else this.pages[this.pages.length - 1] += op;
  }

  /**
   * Run `fn` capturing its draw ops into a returned string instead of a page —
   * used to build header/footer ops once the page count is known, then stamp
   * them via prependToPage without disturbing the body.
   */
  withScratch(fn: () => void): string {
    const saved = this.scratch;
    this.scratch = "";
    fn();
    const out = this.scratch;
    this.scratch = saved;
    return out;
  }

  /** Prepend ops to a specific page (used to stamp headers/footers last). */
  prependToPage(index: number, ops: string): void {
    this.pages[index] = ops + this.pages[index];
  }

  /** Draw text. Returns the advance width of the drawn string. */
  text(x: number, y: number, s: string, opts: TextOpts = {}): number {
    const size = opts.size ?? 10;
    const bold = opts.bold ?? false;
    const [r, g, b] = opts.color ?? [0, 0, 0];
    const w = textWidth(s, size, bold);
    let tx = x;
    if (opts.align === "center") tx = x - w / 2;
    else if (opts.align === "right") tx = x - w;
    const py = this.height - y;
    this.write(
      `BT /${bold ? "F2" : "F1"} ${F(size)} Tf ${F(r)} ${F(g)} ${F(b)} rg ` +
        `1 0 0 1 ${F(tx)} ${F(py)} Tm (${pdfLiteral(s)}) Tj ET\n`,
    );
    return w;
  }

  /** Filled rectangle (top-left origin). */
  fillRect(x: number, y: number, w: number, h: number, color: RGB): void {
    const [r, g, b] = color;
    this.write(`${F(r)} ${F(g)} ${F(b)} rg ${F(x)} ${F(this.height - y - h)} ${F(w)} ${F(h)} re f\n`);
  }

  /** Stroked rectangle outline. */
  strokeRect(x: number, y: number, w: number, h: number, color: RGB, lineWidth = 0.5): void {
    const [r, g, b] = color;
    this.write(`${F(r)} ${F(g)} ${F(b)} RG ${F(lineWidth)} w ${F(x)} ${F(this.height - y - h)} ${F(w)} ${F(h)} re S\n`);
  }

  /** Horizontal (or any) line, top-left coords. */
  line(x1: number, y1: number, x2: number, y2: number, color: RGB = [0.8, 0.8, 0.8], lineWidth = 0.5): void {
    const [r, g, b] = color;
    this.write(
      `${F(r)} ${F(g)} ${F(b)} RG ${F(lineWidth)} w ` +
        `${F(x1)} ${F(this.height - y1)} m ${F(x2)} ${F(this.height - y2)} l S\n`,
    );
  }

  /** Serialize to PDF bytes. */
  toBytes(): Uint8Array {
    const objects: string[] = [];
    // Reserve: 1=Catalog, 2=Pages, then per page: content + page objects, then 2 fonts.
    const pageCount = this.pages.length;
    const fontRegular = 3 + pageCount * 2;
    const fontBold = fontRegular + 1;

    // 1 Catalog
    objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
    // 2 Pages
    const kids = this.pages.map((_, i) => `${3 + i * 2 + 1} 0 R`).join(" ");
    objects.push(`<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>`);

    // Per page: content stream object then page object. Every character in the
    // document is ≤ 0xFF (WinAnsi text + ASCII operators), so it is emitted as
    // Latin-1 (1 byte/char) — string length IS the byte length, which keeps the
    // xref offsets and stream /Length exact.
    this.pages.forEach((content) => {
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const contentObjNum = objects.length; // this content object's number
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${F(this.width)} ${F(this.height)}] ` +
          `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
          `/Contents ${contentObjNum} 0 R >>`,
      );
    });

    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

    // Assemble with a byte-accurate xref table (offsets = char count = byte count).
    let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];
    objects.forEach((obj, i) => {
      offsets.push(body.length);
      body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xrefStart = body.length;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${off.toString().padStart(10, "0")} 00000 n \n`;
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    body += xref + trailer;

    const out = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
    return out;
  }
}

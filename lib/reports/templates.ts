/**
 * Reusable PDF report templates (Phase 3.0B — Deliverable 5). Server + client safe.
 * ---------------------------------------------------------------------------
 * Shared, composable building blocks on top of the ./pdf core: corporate header,
 * footer (page numbers + confidential), KPI card row, section header, table (with
 * auto-pagination), totals row and signature block. A `ReportLayout` tracks the
 * vertical cursor and page breaks; header + footer are stamped on every page at
 * finish(), once the page count is known. Any future report reuses these.
 */
import { PdfDoc, textWidth, type RGB, type Orientation } from "./pdf";

// ---- corporate palette (mirrors the app's navy / teal / sand) ----------------
const NAVY: RGB = [0.055, 0.094, 0.165];
const TEAL: RGB = [0.0, 0.5, 0.5];
const TEAL_LIGHT: RGB = [0.6, 0.83, 0.83];
const SLATE: RGB = [0.42, 0.45, 0.5];
const SAND: RGB = [0.965, 0.957, 0.925];
const BORDER: RGB = [0.85, 0.86, 0.88];
const ZEBRA: RGB = [0.972, 0.972, 0.962];
const WHITE: RGB = [1, 1, 1];
const TEXT: RGB = [0.1, 0.13, 0.18];
const RED: RGB = [0.7, 0.12, 0.12];

const MARGIN = 40;
const HEADER_H = 58;
const META_H = 20;
const FOOTER_H = 30;
const ROW_H = 18;

/** Tenant-resolved report chrome (Phase 4.0B-4/5). Falls back to Effitrans defaults. */
export type ReportBrand = {
  header: string;
  footer: string;
  displayName: string;
  /** wordmark/report subtitle; empty for a tenant without a tagline (no leak) */
  subtitle?: string;
  /** header band colour (from tenant primary_color) */
  primary?: RGB;
  /** accent line colour (from tenant secondary_color) */
  accent?: RGB;
};

export type ReportMeta = {
  title: string;
  dateRange: string;
  generatedAt: string;
  generatedBy: string;
  /** tenant branding for the header/footer; omitted → Effitrans defaults */
  brand?: ReportBrand;
};

export type KpiCard = { label: string; value: string; hint?: string; accent?: "navy" | "teal" | "red" };
export type ColAlign = "left" | "right";
export type TableOpts = { weights?: number[]; align?: ColAlign[] };

/** French number formatting: space thousands groups, comma decimals. */
export function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const neg = n < 0;
  const rounded = Math.round(Math.abs(n) * 100) / 100;
  const [int, dec] = rounded.toString().split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (neg ? "-" : "") + grouped + (dec ? `,${dec}` : "");
}

function cellText(v: string | number | null): { text: string; numeric: boolean } {
  if (typeof v === "number") return { text: fmtNumber(v), numeric: true };
  return { text: v == null ? "—" : String(v), numeric: false };
}

export class ReportLayout {
  readonly doc: PdfDoc;
  private meta: ReportMeta;
  private x0: number;
  private x1: number;
  private top: number;
  private bottom: number;
  private y: number;

  constructor(meta: ReportMeta, orientation: Orientation = "portrait") {
    this.doc = new PdfDoc({ size: "A4", orientation });
    this.meta = meta;
    this.x0 = MARGIN;
    this.x1 = this.doc.width - MARGIN;
    this.top = HEADER_H + META_H + 14;
    this.bottom = this.doc.height - FOOTER_H - 8;
    this.y = this.top;
  }

  get contentWidth(): number {
    return this.x1 - this.x0;
  }

  private ensure(space: number): void {
    if (this.y + space > this.bottom) {
      this.doc.addPage();
      this.y = this.top;
    }
  }

  gap(h = 10): void {
    this.y += h;
  }

  /** Wrapped paragraph (executive summary text). */
  paragraph(text: string, opts: { size?: number; color?: RGB } = {}): void {
    const size = opts.size ?? 9.5;
    const color = opts.color ?? SLATE;
    const lineH = size + 4;
    const words = text.split(/\s+/);
    let line = "";
    const flush = () => {
      if (!line) return;
      this.ensure(lineH);
      this.doc.text(this.x0, this.y + size, line, { size, color });
      this.y += lineH;
      line = "";
    };
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (textWidth(candidate, size) > this.contentWidth && line) {
        flush();
        line = w;
      } else {
        line = candidate;
      }
    }
    flush();
  }

  sectionHeader(title: string): void {
    this.ensure(28);
    this.doc.fillRect(this.x0, this.y, 3, 13, TEAL);
    this.doc.text(this.x0 + 9, this.y + 11, title, { size: 12, bold: true, color: NAVY });
    this.y += 18;
    this.doc.line(this.x0, this.y, this.x1, this.y, BORDER, 0.6);
    this.y += 12;
  }

  /** A row of KPI cards (wraps at 4 per row). */
  kpiCards(cards: KpiCard[]): void {
    if (cards.length === 0) return;
    const perRow = Math.min(4, cards.length);
    const gap = 10;
    const cardW = (this.contentWidth - gap * (perRow - 1)) / perRow;
    const cardH = 46;
    for (let i = 0; i < cards.length; i++) {
      const col = i % perRow;
      if (col === 0) this.ensure(cardH + 8);
      const x = this.x0 + col * (cardW + gap);
      const c = cards[i];
      const accent = c.accent === "teal" ? TEAL : c.accent === "red" ? RED : NAVY;
      this.doc.fillRect(x, this.y, cardW, cardH, SAND);
      this.doc.fillRect(x, this.y, 3, cardH, accent);
      this.doc.text(x + 10, this.y + 14, c.label.toUpperCase(), { size: 7, color: SLATE });
      this.doc.text(x + 10, this.y + 31, c.value, { size: 14, bold: true, color: accent });
      if (c.hint) this.doc.text(x + 10, this.y + 42, c.hint, { size: 7, color: SLATE });
      if (col === perRow - 1 || i === cards.length - 1) this.y += cardH + 10;
    }
  }

  private colWidths(count: number, opts?: TableOpts): number[] {
    const weights = opts?.weights && opts.weights.length === count ? opts.weights : Array(count).fill(1);
    const sum = weights.reduce((s, w) => s + w, 0);
    return weights.map((w) => (w / sum) * this.contentWidth);
  }

  table(headers: string[], rows: (string | number | null)[][], opts?: TableOpts): void {
    const widths = this.colWidths(headers.length, opts);
    const aligns: ColAlign[] =
      opts?.align ?? headers.map((_, c) => (rows.some((r) => typeof r[c] === "number") ? "right" : "left"));

    const drawHead = () => {
      this.doc.fillRect(this.x0, this.y, this.contentWidth, ROW_H, NAVY);
      let x = this.x0;
      headers.forEach((h, c) => {
        const tx = aligns[c] === "right" ? x + widths[c] - 6 : x + 6;
        this.doc.text(tx, this.y + 12.5, h, { size: 8, bold: true, color: WHITE, align: aligns[c] });
        x += widths[c];
      });
      this.y += ROW_H;
    };

    this.ensure(ROW_H * 2);
    drawHead();
    rows.forEach((row, i) => {
      if (this.y + ROW_H > this.bottom) {
        this.doc.addPage();
        this.y = this.top;
        drawHead();
      }
      if (i % 2 === 1) this.doc.fillRect(this.x0, this.y, this.contentWidth, ROW_H, ZEBRA);
      let x = this.x0;
      row.forEach((cell, c) => {
        const { text } = cellText(cell);
        const tx = aligns[c] === "right" ? x + widths[c] - 6 : x + 6;
        this.doc.text(tx, this.y + 12.5, text, { size: 8, color: TEXT, align: aligns[c] });
        x += widths[c];
      });
      this.y += ROW_H;
    });
    this.doc.line(this.x0, this.y, this.x1, this.y, BORDER, 0.6);
    this.y += 6;
  }

  /** A bold totals row (label left, value right). */
  totals(pairs: { label: string; value: string | number }[]): void {
    for (const p of pairs) {
      this.ensure(ROW_H);
      this.doc.fillRect(this.x0, this.y, this.contentWidth, ROW_H, SAND);
      this.doc.text(this.x0 + 6, this.y + 12.5, p.label, { size: 8.5, bold: true, color: NAVY });
      const { text } = cellText(p.value);
      this.doc.text(this.x1 - 6, this.y + 12.5, text, { size: 8.5, bold: true, color: NAVY, align: "right" });
      this.y += ROW_H + 2;
    }
  }

  signatureBlock(): void {
    this.ensure(60);
    this.y += 14;
    const colW = (this.contentWidth - 30) / 2;
    const labels = ["Préparé par", "Approuvé par"];
    for (let i = 0; i < 2; i++) {
      const x = this.x0 + i * (colW + 30);
      this.doc.line(x, this.y + 26, x + colW, this.y + 26, SLATE, 0.6);
      this.doc.text(x, this.y + 38, labels[i], { size: 8, color: SLATE });
    }
    this.y += 46;
  }

  /** Stamp header + footer on every page. Call once, after the body is laid out. */
  finish(): Uint8Array {
    const total = this.doc.pageCount;
    for (let i = 0; i < total; i++) {
      const ops = this.doc.withScratch(() => this.drawChrome(i + 1, total));
      this.doc.prependToPage(i, ops);
    }
    return this.doc.toBytes();
  }

  private drawChrome(page: number, total: number): void {
    const d = this.doc;
    // Header band.
    const brandPrimary = this.meta.brand?.primary ?? NAVY;
    const brandAccent = this.meta.brand?.accent ?? TEAL;
    const brandSubtitle = this.meta.brand?.subtitle ?? "";
    d.fillRect(0, 0, d.width, HEADER_H, brandPrimary);
    d.fillRect(0, HEADER_H, d.width, 2, brandAccent);
    d.text(MARGIN, 24, this.meta.brand?.header ?? "EFFITRANS OPERATIONS", { size: 14, bold: true, color: WHITE });
    d.text(MARGIN, 40, brandSubtitle, { size: 8, color: TEAL_LIGHT });
    d.text(d.width - MARGIN, 24, this.meta.title, { size: 12, bold: true, color: WHITE, align: "right" });
    d.text(d.width - MARGIN, 40, this.meta.dateRange, { size: 8, color: TEAL_LIGHT, align: "right" });

    // Meta row (period / generation) under the band.
    const my = HEADER_H + 14;
    d.text(MARGIN, my, `Généré le ${this.meta.generatedAt}`, { size: 7.5, color: SLATE });
    d.text(d.width - MARGIN, my, `Par : ${this.meta.generatedBy}`, { size: 7.5, color: SLATE, align: "right" });

    // Footer.
    const fy = d.height - FOOTER_H + 6;
    d.line(MARGIN, fy - 6, d.width - MARGIN, fy - 6, BORDER, 0.6);
    d.text(MARGIN, fy + 6, this.meta.brand?.footer ?? "Effitrans Operations — Document confidentiel", { size: 7.5, color: SLATE });
    d.text(d.width / 2, fy + 6, brandSubtitle, { size: 7.5, color: SLATE, align: "center" });
    d.text(d.width - MARGIN, fy + 6, `Page ${page} / ${total}`, { size: 7.5, color: SLATE, align: "right" });
  }
}

/**
 * Slide + communication SVG renderers (DBC-5). PURE — deterministic, no I/O.
 * ---------------------------------------------------------------------------
 * SVG is a declarative vector (NOT a screenshot / browser render): the string IS the
 * artifact. Used to PREVIEW slides (PPTX cannot render in-browser) and as the downloadable
 * LinkedIn/social masters. Brand colours injected; every text value escaped; no <script>,
 * no external fonts (a safe generic stack).
 */
import { xmlEsc } from "@/lib/brand/docx/ooxml";
import type { Slide, DeckBrand, CommunicationModel } from "./model";

const FONT = "Segoe UI, Arial, Helvetica, sans-serif";
const W = 1280, H = 720;

function t(x: number, y: number, s: string, opts: { size?: number; color?: string; weight?: number; anchor?: string } = {}): string {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${opts.size ?? 24}" fill="${opts.color ?? "#333F48"}" font-weight="${opts.weight ?? 400}" text-anchor="${opts.anchor ?? "start"}">${xmlEsc(s)}</text>`;
}

function frame(brand: DeckBrand, index: number, total: number, body: string, bg = "#ffffff"): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img">` +
    `<rect width="${W}" height="${H}" fill="${bg}"/>` +
    body +
    `<rect x="0" y="${H - 40}" width="${W}" height="40" fill="${brand.green}"/>` +
    t(40, H - 14, brand.companyName, { size: 16, color: "#ffffff", weight: 700 }) +
    t(W - 40, H - 14, `${index + 1} / ${total}`, { size: 14, color: "#ffffff", anchor: "end" }) +
    `</svg>`
  );
}

/** Render one slide to an approximate branded SVG (16:9). */
export function renderSlideSvg(slide: Slide, brand: DeckBrand, index: number, total: number): string {
  const g = brand.green, a = brand.anthracite;
  switch (slide.type) {
    case "TITLE":
      return frame(brand, index, total,
        `<rect x="0" y="0" width="14" height="${H}" fill="${g}"/>` +
        t(80, 320, slide.title, { size: 56, color: g, weight: 800 }) +
        (slide.subtitle ? t(80, 380, slide.subtitle, { size: 26, color: a }) : ""));
    case "SECTION":
      return frame(brand, index, total, t(80, 380, slide.title, { size: 48, color: "#ffffff", weight: 800 }), g);
    case "AGENDA":
    case "CONTENT": {
      const items = slide.type === "AGENDA" ? slide.items : slide.bullets;
      const lines = items.map((it, i) => `<circle cx="90" cy="${196 + i * 56 - 6}" r="5" fill="${g}"/>${t(112, 200 + i * 56, it, { size: 24, color: a })}`).join("");
      return frame(brand, index, total, t(80, 130, slide.title, { size: 40, color: g, weight: 800 }) + `<rect x="80" y="150" width="120" height="4" fill="${brand.gold}"/>` + lines);
    }
    case "TABLE": {
      const colW = (W - 160) / Math.max(1, slide.headers.length);
      const header = slide.headers.map((h, i) => `<rect x="${80 + i * colW}" y="180" width="${colW}" height="40" fill="${g}"/>${t(90 + i * colW, 207, h, { size: 18, color: "#fff", weight: 700 })}`).join("");
      const rows = slide.rows.map((r, ri) => r.map((c, ci) => t(90 + ci * colW, 250 + ri * 36, c, { size: 16, color: a })).join("")).join("");
      return frame(brand, index, total, t(80, 130, slide.title, { size: 40, color: g, weight: 800 }) + header + rows);
    }
    case "CHART": {
      const max = Math.max(1, ...slide.data.map((d) => d.value));
      const bw = (W - 200) / Math.max(1, slide.data.length);
      const bars = slide.data.map((d, i) => {
        const bh = (d.value / max) * 380;
        return `<rect x="${120 + i * bw}" y="${560 - bh}" width="${bw * 0.6}" height="${bh}" fill="${g}"/>${t(120 + i * bw + bw * 0.3, 590, d.label, { size: 16, color: a, anchor: "middle" })}`;
      }).join("");
      return frame(brand, index, total, t(80, 130, slide.title, { size: 40, color: g, weight: 800 }) + bars);
    }
    case "TIMELINE": {
      const step = (W - 160) / Math.max(1, slide.milestones.length);
      const line = `<rect x="80" y="360" width="${W - 160}" height="4" fill="${brand.gold}"/>`;
      const pts = slide.milestones.map((m, i) => `<circle cx="${100 + i * step}" cy="362" r="8" fill="${g}"/>${t(100 + i * step, 330, m.when, { size: 16, color: g, weight: 700, anchor: "middle" })}${t(100 + i * step, 400, m.label, { size: 16, color: a, anchor: "middle" })}`).join("");
      return frame(brand, index, total, t(80, 130, slide.title, { size: 40, color: g, weight: 800 }) + line + pts);
    }
    case "QUOTE":
      return frame(brand, index, total,
        t(80, 300, "“", { size: 120, color: brand.gold, weight: 800 }) +
        t(120, 320, slide.quote, { size: 34, color: a }) +
        (slide.author ? t(120, 390, `— ${slide.author}`, { size: 22, color: g }) : ""));
    case "IMAGE":
      return frame(brand, index, total,
        t(80, 130, slide.title, { size: 40, color: g, weight: 800 }) +
        `<rect x="80" y="170" width="${W - 160}" height="420" fill="#f1f5f9" stroke="#cbd5e1"/>` +
        t(W / 2, 390, "Zone image (à insérer dans PowerPoint)", { size: 22, color: "#94a3b8", anchor: "middle" }) +
        (slide.caption ? t(80, 630, slide.caption, { size: 18, color: a }) : ""));
    case "THANK_YOU":
      return frame(brand, index, total, t(80, 360, slide.title, { size: 60, color: "#ffffff", weight: 800 }) + (slide.subtitle ? t(80, 420, slide.subtitle, { size: 26, color: "#ffffff" }) : ""), g);
  }
}

/** Render a LinkedIn/social master to a downloadable branded SVG. */
export function renderCommunicationSvg(m: CommunicationModel): string {
  const { width: w, height: h, brand } = m;
  const g = brand.green;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img">`,
    `<rect width="${w}" height="${h}" fill="${g}"/>`,
    `<rect x="0" y="0" width="${Math.max(8, Math.round(w * 0.012))}" height="${h}" fill="${brand.gold}"/>`,
  ];
  const pad = Math.round(w * 0.05);
  parts.push(`<text x="${pad}" y="${Math.round(h * 0.34)}" font-family="${FONT}" font-size="${Math.round(h * 0.14)}" font-weight="800" fill="#ffffff">${xmlEsc(m.headline)}</text>`);
  if (m.subline) parts.push(`<text x="${pad}" y="${Math.round(h * 0.5)}" font-family="${FONT}" font-size="${Math.round(h * 0.07)}" fill="#ffffff" opacity="0.92">${xmlEsc(m.subline)}</text>`);
  if (m.person) {
    parts.push(`<text x="${pad}" y="${Math.round(h * 0.7)}" font-family="${FONT}" font-size="${Math.round(h * 0.08)}" font-weight="700" fill="#ffffff">${xmlEsc(m.person.name)}</text>`);
    if (m.person.title) parts.push(`<text x="${pad}" y="${Math.round(h * 0.8)}" font-family="${FONT}" font-size="${Math.round(h * 0.055)}" fill="#ffffff" opacity="0.9">${xmlEsc(m.person.title)}</text>`);
  }
  parts.push(`<text x="${w - pad}" y="${h - Math.round(h * 0.08)}" font-family="${FONT}" font-size="${Math.round(h * 0.05)}" fill="#ffffff" text-anchor="end" opacity="0.9">${xmlEsc(brand.companyName)}${brand.slogan ? " · " + xmlEsc(brand.slogan) : ""}</text>`);
  parts.push(`</svg>`);
  return parts.join("");
}

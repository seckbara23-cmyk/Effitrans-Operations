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

// ===================================================== social composition ====
//
// ONE composition, TWO serializers (Brand Center social hardening).
// composeCommunication computes every rectangle, image box and text line —
// absolute coordinates, fitted font sizes, safe zones — as a plain SPEC.
// renderCommunicationSvg serializes that spec to the canonical vector master;
// the PNG renderer (lib/brand/presentation/png.ts) serializes THE SAME SPEC to
// a raster. Preview, SVG and PNG therefore cannot drift: they share the model
// AND the computed layout.
//
// Composition rules, each one answering a production UAT finding:
//   * the title is CONTENT and appears exactly ONCE — the old renderer echoed
//     « companyName · slogan » in 9px at the bottom right, which duplicated
//     the default headline microscopically;
//   * the APPROVED logo (resolved upstream to a data URI) carries the company
//     identity; the company name is drawn only when NO logo is published;
//   * text is FITTED: a long title shrinks stepwise instead of clipping, and
//     everything lives inside an explicit safe zone;
//   * a blank subline renders NOTHING (no empty <text>, no reserved gap).

export type SpecItem =
  | { t: "rect"; x: number; y: number; w: number; h: number; fill: string; opacity?: number }
  | { t: "image"; x: number; y: number; w: number; h: number; href: string; alt: string }
  | { t: "text"; x: number; top: number; size: number; weight: number; fill: string; text: string; opacity?: number };

export type CommunicationSpec = { width: number; height: number; background: string; items: SpecItem[] };

/** Average glyph advance ≈ 0.56 × size for the generic UI stack — deliberately
 *  a slight over-estimate so the fit errs toward smaller, never clipping. */
export function estimateTextWidth(text: string, size: number): number {
  return Math.ceil(text.length * size * 0.56);
}

/** Largest size ≤ startSize (≥ minSize) whose estimated width fits maxWidth. */
export function fitTextSize(text: string, maxWidth: number, startSize: number, minSize = 12): number {
  let size = startSize;
  while (size > minSize && estimateTextWidth(text, size) > maxWidth) size -= 1;
  return size;
}

/** Shrink, and when even minSize would overflow, TRUNCATE with an ellipsis —
 *  the no-clipping guarantee holds for any input length. */
export function fitText(text: string, maxWidth: number, startSize: number, minSize = 12): { text: string; size: number } {
  const size = fitTextSize(text, maxWidth, startSize, minSize);
  if (estimateTextWidth(text, size) <= maxWidth) return { text, size };
  let t = text;
  while (t.length > 1 && estimateTextWidth(`${t.trimEnd()}…`, size) > maxWidth) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, size };
}

/** Compute the full layout for a social master. PURE — the single source both
 *  serializers consume. */
export function composeCommunication(m: CommunicationModel): CommunicationSpec {
  const { width: w, height: h, brand } = m;
  const wide = h < w * 0.35; // banner formats (company 1128×191, CEO 1584×396)
  const pad = Math.max(40, Math.round(Math.min(w, h) * (wide ? 0.22 : 0.07)));
  const accent = Math.max(8, Math.round(w * 0.008));
  const items: SpecItem[] = [];

  // Gold accent — left edge, full height: the established minimalist mark.
  items.push({ t: "rect", x: 0, y: 0, w: accent, h, fill: brand.gold });

  // Logo block. Banners: left-aligned lockup; tall formats: top block.
  const logoH = wide ? Math.round(h * 0.52) : Math.round(h * 0.14);
  const logoW = Math.round(logoH * 2.4); // contain-fit box; wider marks letterbox cleanly
  const logoX = pad;
  const logoY = wide ? Math.round((h - logoH) / 2) : pad;
  let textX = pad;
  const textRight = w - pad;
  if (m.logo) {
    items.push({ t: "image", x: logoX, y: logoY, w: logoW, h: logoH, href: m.logo.href, alt: m.logo.alt });
    if (wide) {
      // Vertical hairline between logo and text, breathing room both sides.
      const divX = logoX + logoW + Math.round(pad * 0.75);
      items.push({ t: "rect", x: divX, y: Math.round(h * 0.22), w: 2, h: Math.round(h * 0.56), fill: "#ffffff", opacity: 0.45 });
      textX = divX + Math.round(pad * 0.75);
    }
  } else {
    // No published logo: the company name — ONCE — takes the identity slot.
    const nameSize = wide ? Math.round(h * 0.16) : Math.round(h * 0.045);
    items.push({ t: "text", x: logoX, top: wide ? Math.round(h / 2 - nameSize * 0.65) : pad, size: nameSize, weight: 800, fill: "#ffffff", text: brand.companyName });
    if (wide) {
      const divX = logoX + estimateTextWidth(brand.companyName, nameSize) + Math.round(pad * 0.75);
      items.push({ t: "rect", x: divX, y: Math.round(h * 0.22), w: 2, h: Math.round(h * 0.56), fill: "#ffffff", opacity: 0.45 });
      textX = divX + Math.round(pad * 0.75);
    }
  }

  const textWidth = textRight - textX;
  const hasSub = Boolean(m.subline);

  if (wide) {
    // Banner: title (and optional subtitle) vertically centred right of the lockup.
    const title = fitText(m.headline, textWidth, Math.round(h * 0.24), 16);
    if (hasSub) {
      const sub = fitText(m.subline!, textWidth, Math.round(h * 0.11), 12);
      const gap = Math.round(h * 0.07);
      const blockH = title.size + gap + sub.size;
      const topT = Math.round((h - blockH) / 2);
      items.push({ t: "text", x: textX, top: topT, size: title.size, weight: 800, fill: "#ffffff", text: title.text });
      items.push({ t: "text", x: textX, top: topT + title.size + gap, size: sub.size, weight: 400, fill: "#ffffff", opacity: 0.92, text: sub.text });
    } else {
      items.push({ t: "text", x: textX, top: Math.round((h - title.size) / 2), size: title.size, weight: 800, fill: "#ffffff", text: title.text });
    }
    if (m.person) {
      const p = fitText(m.person.name, textWidth, Math.round(h * 0.09), 12);
      items.push({ t: "text", x: textX, top: h - pad - (m.person.title ? Math.round(p.size * 2.3) : p.size), size: p.size, weight: 700, fill: "#ffffff", text: p.text });
      if (m.person.title) {
        const pt = fitText(m.person.title, textWidth, Math.round(h * 0.065), 11);
        items.push({ t: "text", x: textX, top: h - pad - pt.size, size: pt.size, weight: 400, fill: "#ffffff", opacity: 0.9, text: pt.text });
      }
    }
  } else {
    // Square / announcement: stacked, generous middle, gold rule under the title.
    const title = fitText(m.headline, w - pad * 2, Math.round(h * 0.075), 20);
    const titleTop = Math.round(h * (hasSub ? 0.42 : 0.46));
    items.push({ t: "text", x: pad, top: titleTop, size: title.size, weight: 800, fill: "#ffffff", text: title.text });
    items.push({ t: "rect", x: pad, y: titleTop + title.size + Math.round(h * 0.03), w: Math.round(w * 0.12), h: 6, fill: brand.gold });
    if (hasSub) {
      const sub = fitText(m.subline!, w - pad * 2, Math.round(h * 0.035), 14);
      items.push({ t: "text", x: pad, top: titleTop + title.size + Math.round(h * 0.06), size: sub.size, weight: 400, fill: "#ffffff", opacity: 0.92, text: sub.text });
    }
    if (m.person) {
      const pSize = Math.round(h * 0.032);
      items.push({ t: "text", x: pad, top: h - pad - (m.person.title ? Math.round(pSize * 2.4) : pSize), size: pSize, weight: 700, fill: "#ffffff", text: m.person.name });
      if (m.person.title) {
        items.push({ t: "text", x: pad, top: h - pad - Math.round(pSize * 0.9), size: Math.round(pSize * 0.8), weight: 400, fill: "#ffffff", opacity: 0.9, text: m.person.title });
      }
    }
  }

  return { width: w, height: h, background: brand.green, items };
}

/** Serialize the spec to the canonical vector master. Text y converts the
 *  spec's TOP coordinate to an SVG baseline (≈ 0.78 × size ascent). */
export function specToSvg(spec: CommunicationSpec): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="100%" role="img">`,
    `<rect width="${spec.width}" height="${spec.height}" fill="${spec.background}"/>`,
  ];
  for (const it of spec.items) {
    if (it.t === "rect") {
      parts.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${it.fill}"${it.opacity !== undefined ? ` opacity="${it.opacity}"` : ""}/>`);
    } else if (it.t === "image") {
      parts.push(`<image x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" href="${xmlEsc(it.href)}" preserveAspectRatio="xMinYMid meet" aria-label="${xmlEsc(it.alt)}"/>`);
    } else {
      const baseline = it.top + Math.round(it.size * 0.78);
      parts.push(`<text x="${it.x}" y="${baseline}" font-family="${FONT}" font-size="${it.size}" font-weight="${it.weight}" fill="${it.fill}"${it.opacity !== undefined ? ` opacity="${it.opacity}"` : ""}>${xmlEsc(it.text)}</text>`);
    }
  }
  parts.push(`</svg>`);
  return parts.join("");
}

/** Render a LinkedIn/social master to a downloadable branded SVG. */
export function renderCommunicationSvg(m: CommunicationModel): string {
  return specToSvg(composeCommunication(m));
}

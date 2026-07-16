/**
 * Minimal PPTX (OOXML) builder (DBC-5). PURE.
 * ---------------------------------------------------------------------------
 * REUSES the DBC-4 ZIP writer + xmlEsc — same OOXML approach as DOCX, no HTML, no
 * screenshots, no browser rendering. Produces an EDITABLE PowerPoint: a full presentation
 * package (presentation + theme + one master + one layout + N slides, all cross-referenced)
 * with brand colours in the theme + on the slides. Slides are branded TEXT masters (rich
 * tables/charts are the user's to add / are shown in the SVG preview). Every value escaped.
 *
 * PowerPoint-opens verification is an operator step (no PowerPoint in CI) — the structure
 * follows the OOXML minimal-package spec; tests assert the ZIP + parts + escaping.
 */
import { zipStore } from "@/lib/brand/docx/zip";
import { xmlEsc } from "@/lib/brand/docx/ooxml";
import type { Deck, Slide, DeckBrand } from "@/lib/brand/presentation/model";

const CX = 12192000, CY = 6858000; // 16:9 EMU
const hex = (h: string) => h.replace(/^#/, "").toUpperCase();

// ---------------------------------------------------------------- shapes ----

function run(text: string, size: number, bold: boolean, color: string): string {
  return `<a:r><a:rPr lang="fr-FR" sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill></a:rPr><a:t>${xmlEsc(text)}</a:t></a:r>`;
}
function para(runXml: string, align: "l" | "ctr" = "l"): string {
  return `<a:p><a:pPr algn="${align}"><a:buNone/></a:pPr>${runXml}</a:p>`;
}
let SID = 1;
function textBox(x: number, y: number, cx: number, cy: number, paras: string, fill: string | null = null): string {
  const f = fill ? `<a:solidFill><a:srgbClr val="${hex(fill)}"/></a:solidFill>` : "<a:noFill/>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${++SID}" name="tb"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${f}</p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}
function rect(x: number, y: number, cx: number, cy: number, fill: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${++SID}" name="r"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${hex(fill)}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function footer(brand: DeckBrand, index: number, total: number): string {
  return (
    rect(0, CY - 380000, CX, 380000, brand.green) +
    textBox(457200, CY - 340000, CX - 1500000, 300000, para(run(brand.companyName, 1100, true, "#FFFFFF")), null) +
    textBox(CX - 1200000, CY - 340000, 900000, 300000, para(run(`${index + 1} / ${total}`, 1000, false, "#FFFFFF"), "ctr"))
  );
}

function bodyLines(lines: string[], color: string): string {
  return lines.map((l) => para(run(`•  ${l}`, 1600, false, color))).join("");
}

function slideShapes(slide: Slide, brand: DeckBrand, index: number, total: number): string {
  const g = brand.green, a = brand.anthracite, TITLE = { x: 500000, y: 500000, cx: CX - 1000000, cy: 900000 };
  const bodyBox = (paras: string) => textBox(500000, 1600000, CX - 1000000, CY - 2400000, paras);
  const heading = (txt: string, color = g) => textBox(TITLE.x, TITLE.y, TITLE.cx, TITLE.cy, para(run(txt, 3600, true, color)));

  let inner = "";
  switch (slide.type) {
    case "TITLE":
      inner = rect(0, 0, 180000, CY, g) + textBox(700000, 2500000, CX - 1400000, 1000000, para(run(slide.title, 5400, true, g))) +
        (slide.subtitle ? textBox(700000, 3600000, CX - 1400000, 700000, para(run(slide.subtitle, 2400, false, a))) : "");
      break;
    case "SECTION":
      return rect(0, 0, CX, CY, g) + textBox(700000, 2900000, CX - 1400000, 1000000, para(run(slide.title, 4400, true, "#FFFFFF"))) + footer(brand, index, total);
    case "AGENDA":
      inner = heading("Ordre du jour") + bodyBox(bodyLines(slide.items, a));
      break;
    case "CONTENT":
      inner = heading(slide.title) + bodyBox(bodyLines(slide.bullets, a));
      break;
    case "TABLE":
      inner = heading(slide.title) + bodyBox([slide.headers.join("    "), ...slide.rows.map((r) => r.join("    "))].map((l, i) => para(run(l, 1500, i === 0, i === 0 ? g : a))).join(""));
      break;
    case "CHART":
      inner = heading(slide.title) + bodyBox(slide.data.map((d) => para(run(`${d.label} : ${d.value}`, 1600, false, a))).join(""));
      break;
    case "TIMELINE":
      inner = heading(slide.title) + bodyBox(slide.milestones.map((m) => para(run(`${m.when} — ${m.label}`, 1600, false, a))).join(""));
      break;
    case "QUOTE":
      inner = textBox(700000, 2400000, CX - 1400000, 1500000, para(run(`« ${slide.quote} »`, 3200, false, a))) +
        (slide.author ? textBox(700000, 3900000, CX - 1400000, 600000, para(run(`— ${slide.author}`, 2000, true, g))) : "");
      break;
    case "IMAGE":
      inner = heading(slide.title) + rect(500000, 1600000, CX - 1000000, CY - 2600000, "#F1F5F9") +
        textBox(500000, CY - 1000000, CX - 1000000, 400000, para(run(slide.caption ?? "Zone image", 1400, false, a)));
      break;
    case "THANK_YOU":
      return rect(0, 0, CX, CY, g) + textBox(700000, 2700000, CX - 1400000, 1000000, para(run(slide.title, 5400, true, "#FFFFFF"))) +
        (slide.subtitle ? textBox(700000, 3900000, CX - 1400000, 600000, para(run(slide.subtitle, 2200, false, "#FFFFFF"))) : "") + footer(brand, index, total);
  }
  return inner + footer(brand, index, total);
}

function slideXml(slide: Slide, brand: DeckBrand, index: number, total: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    slideShapes(slide, brand, index, total) +
    `</p:spTree></p:cSld></p:sld>`
  );
}

// ---------------------------------------------------------------- fixed parts ----

function theme(brand: DeckBrand): string {
  const g = hex(brand.green), gold = hex(brand.gold), dk = hex(brand.anthracite);
  const clr = (v: string) => `<a:srgbClr val="${v}"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Effitrans"><a:themeElements>` +
    `<a:clrScheme name="Effitrans"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
    `<a:dk2>${clr(dk)}</a:dk2><a:lt2>${clr("F1F5F9")}</a:lt2><a:accent1>${clr(g)}</a:accent1><a:accent2>${clr(gold)}</a:accent2>` +
    `<a:accent3>${clr(dk)}</a:accent3><a:accent4>${clr("94A3B8")}</a:accent4><a:accent5>${clr("CBD5E1")}</a:accent5><a:accent6>${clr("64748B")}</a:accent6>` +
    `<a:hlink>${clr(g)}</a:hlink><a:folHlink>${clr(dk)}</a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="Effitrans"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Effitrans"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
    `<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>` +
    `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

const NS_P = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const REL_NS = `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"`;
const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const SLIDE_MASTER =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS_P}>` +
  `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const SLIDE_LAYOUT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS_P} type="blank" preserve="1">` +
  `<p:cSld name="Vierge"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** Build a valid, editable .pptx from the deck. */
export function buildPptx(deck: Deck): Uint8Array {
  SID = 1;
  const enc = (s: string) => new TextEncoder().encode(s);
  const n = deck.slides.length;
  const slideIds = deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("");
  const presentation =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS_P}>` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${CX}" cy="${CY}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

  const presRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${REL_NS}>` +
    `<Relationship Id="rId1" Type="${RT}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    deck.slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${RT}/slide" Target="slides/slide${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${n + 2}" Type="${RT}/theme" Target="theme/theme1.xml"/></Relationships>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    deck.slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") +
    `</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${REL_NS}><Relationship Id="rId1" Type="${RT}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;
  const masterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${REL_NS}><Relationship Id="rId1" Type="${RT}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RT}/theme" Target="../theme/theme1.xml"/></Relationships>`;
  const layoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${REL_NS}><Relationship Id="rId1" Type="${RT}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

  const entries = [
    { name: "[Content_Types].xml", data: enc(contentTypes) },
    { name: "_rels/.rels", data: enc(rootRels) },
    { name: "ppt/presentation.xml", data: enc(presentation) },
    { name: "ppt/_rels/presentation.xml.rels", data: enc(presRels) },
    { name: "ppt/theme/theme1.xml", data: enc(theme(deck.brand)) },
    { name: "ppt/slideMasters/slideMaster1.xml", data: enc(SLIDE_MASTER) },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: enc(masterRels) },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: enc(SLIDE_LAYOUT) },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: enc(layoutRels) },
  ];
  deck.slides.forEach((slide, i) => {
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: enc(slideXml(slide, deck.brand, i, n)) });
    entries.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${REL_NS}><Relationship Id="rId1" Type="${RT}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`) });
  });

  return zipStore(entries);
}

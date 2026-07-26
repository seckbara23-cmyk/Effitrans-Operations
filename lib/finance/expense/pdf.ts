/**
 * Autorisation de Dépenses — exact-template PDF renderer (Phase 11.0C).
 * PURE (no I/O, no server-only imports) so the output is unit-testable and
 * deterministic: identical input ⇒ byte-identical PDF.
 * ---------------------------------------------------------------------------
 * The DEC-C16 « Option A » renderer, built as THREE independent layers over the
 * hand-rolled engine (lib/reports/pdf.ts) — never an HTML-to-PDF converter:
 *
 *   1. BACKGROUND — the registered raster of the original paper page, drawn
 *      full-bleed via the JPEG Image XObject primitive added in 11.0B.
 *   2. CHROME     — frame, ruled cells, printed captions and the visa grid,
 *      drawn from the coordinate map. This layer is a STAND-IN: it exists only
 *      while layer 1 has no asset, and is skipped the moment one is registered.
 *   3. VALUES     — the document's data, drawn from the SAME coordinate map.
 *
 * Because layers 2 and 3 read one map, committing the master scan moves nothing:
 * the background switches on, the drawn chrome switches off, and every value
 * stays exactly where it is. Recalibration is then a data edit in
 * ./template-map — never a change here or in the document code.
 *
 * Fidelity rules enforced (11.0A §29): A4 portrait at 1:1 print scale, no
 * scaling factor anywhere; values confined to their cells; overflow handled by
 * stepping the font size DOWN before any truncation, and every truncation is
 * REPORTED to the caller rather than silently clipped.
 */

import { PdfDoc, textWidth, type RGB } from "@/lib/reports/pdf";
import { fmtNumber } from "@/lib/reports/templates";
import {
  AUTHORIZATION_FIELDS,
  AUTHORIZATION_VISA_BOXES,
  CELL_LABEL_DY,
  CELL_PAD_X,
  CELL_VALUE_DY,
  FRAME,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TITLE_BOX,
  VISA_BAND,
  VISA_CAPTION_H,
  VISA_FOOT_RULE_OFFSET,
  type AuthorizationFieldKey,
  type TemplateBox,
  type TemplateField,
} from "./template-map";
import { EXPENSE_TEMPLATES, type ExpenseTemplateBackground } from "./templates";

// ------------------------------------------------------------------ ink ----

const RULE: RGB = [0.25, 0.27, 0.3];
const RULE_LIGHT: RGB = [0.62, 0.64, 0.67];
const LABEL_INK: RGB = [0.36, 0.39, 0.43];
const VALUE_INK: RGB = [0, 0, 0];
const BAND: RGB = [0.925, 0.929, 0.937];

const LABEL_SIZE = 6.5;
const VALUE_SIZE = 10;
const MIN_VALUE_SIZE = 6;
const LINE_RATIO = 1.28;

// ---------------------------------------------------------------- model ----

/**
 * Everything the form prints, already resolved. The renderer performs NO
 * lookups and NO business decisions — it is given the exact strings/numbers so
 * the printed document can never disagree with the stored record.
 */
export type AuthorizationPrintModel = {
  /** Pre-printed letterhead name (chrome layer). */
  companyName: string;
  /** null while the document is a draft — no number is minted before submission. */
  authorizationNumber: string | null;
  /** Human status, printed small in the title band (never a watermark in 11.0C). */
  statusLabel: string;
  /** dd/mm/yyyy. */
  documentDate: string;
  accountNumber: string | null;
  fileNumber: string | null;
  registrationNumber: string | null;
  expenseType: string | null;
  weightKg: number | null;
  beneficiary: string;
  amount: number;
  currency: string;
  amountInWords: string | null;
  agentName: string | null;
  reason: string;
  /** Supporting-document names, printed in the « Pièces jointes » cell. */
  attachments: readonly string[];
  requestedBy: string | null;
};

export type RenderResult = {
  bytes: Uint8Array;
  /** Cells whose value could not fit even at the minimum size (11.0A §29). */
  overflowedFields: AuthorizationFieldKey[];
  /** Whether the original-page raster was available and used. */
  usedTemplateRaster: boolean;
};

/**
 * The raster pages a caller supplies for layer 1, in page order. Empty (the
 * current reality) ⇒ the chrome layer is drawn instead.
 */
export type TemplateRaster = { data: Uint8Array; width: number; height: number; colorSpace?: "rgb" | "gray" };

// ------------------------------------------------------------ formatting ---

const EM_DASH = "—";

/** The printed string for each slot. `null`/empty renders as a blank cell, never "null". */
function valueFor(key: AuthorizationFieldKey, m: AuthorizationPrintModel): string {
  switch (key) {
    case "authorization_number":
      return m.authorizationNumber ?? EM_DASH;
    case "document_date":
      return m.documentDate;
    case "account_number":
      return m.accountNumber ?? "";
    case "file_number":
      return m.fileNumber ?? "";
    case "registration_number":
      return m.registrationNumber ?? "";
    case "expense_type":
      return m.expenseType ?? "";
    case "weight_kg":
      return m.weightKg == null ? "" : fmtNumber(m.weightKg);
    case "beneficiary":
      return m.beneficiary;
    case "amount":
      return fmtNumber(m.amount);
    case "currency":
      return m.currency;
    case "agent_name":
      return m.agentName ?? "";
    case "amount_in_words":
      return m.amountInWords ?? "";
    case "reason":
      return m.reason;
    case "attachments":
      return m.attachments.length === 0 ? "" : m.attachments.join(" · ");
    case "requested_by":
      return m.requestedBy ?? "";
  }
}

/**
 * Greedy word wrap at `width`. Words longer than the line are hard-split so a
 * single long token (a file name, a reference) can never escape its cell.
 */
function wrap(text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Hard-split an over-long single token.
      let rest = word;
      while (textWidth(rest, size) > width && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && textWidth(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines.length === 0 ? [""] : lines;
}

// ----------------------------------------------------------------- layers --

/** Layer 1 — the original page, full bleed. Only when an asset is registered. */
function drawBackground(doc: PdfDoc, raster: TemplateRaster): void {
  doc.drawJpeg(0, 0, PAGE_WIDTH, PAGE_HEIGHT, {
    data: raster.data,
    width: raster.width,
    height: raster.height,
    colorSpace: raster.colorSpace,
  });
}

/** A ruled cell with its pre-printed caption. */
function drawCell(doc: PdfDoc, box: TemplateBox, label: string): void {
  doc.strokeRect(box.x, box.y, box.w, box.h, RULE, 0.7);
  doc.text(box.x + CELL_PAD_X, box.y + CELL_LABEL_DY, label, { size: LABEL_SIZE, color: LABEL_INK, bold: true });
}

/**
 * Layer 2 — the form itself: outer frame, title band, every ruled cell with its
 * caption, and the seven visa boxes. Skipped entirely when layer 1 supplies the
 * real page.
 */
function drawChrome(doc: PdfDoc, companyName: string): void {
  doc.strokeRect(FRAME.x, FRAME.y, FRAME.w, FRAME.h, RULE, 1.1);

  // Title band — letterhead + form name, as pre-printed on the paper.
  doc.fillRect(TITLE_BOX.x, TITLE_BOX.y, TITLE_BOX.w, TITLE_BOX.h, BAND);
  doc.strokeRect(TITLE_BOX.x, TITLE_BOX.y, TITLE_BOX.w, TITLE_BOX.h, RULE, 0.7);
  doc.text(TITLE_BOX.x + CELL_PAD_X + 2, TITLE_BOX.y + 15, companyName.toUpperCase(), {
    size: 8.5,
    bold: true,
    color: LABEL_INK,
  });
  doc.text(TITLE_BOX.x + TITLE_BOX.w / 2, TITLE_BOX.y + 38, "AUTORISATION DE DÉPENSES", {
    size: 15,
    bold: true,
    align: "center",
    color: VALUE_INK,
  });

  for (const f of AUTHORIZATION_FIELDS) drawCell(doc, f.box, f.label);

  // Visa band caption.
  doc.fillRect(VISA_BAND.x, VISA_BAND.y, VISA_BAND.w, VISA_BAND.h, BAND);
  doc.strokeRect(VISA_BAND.x, VISA_BAND.y, VISA_BAND.w, VISA_BAND.h, RULE, 0.7);
  doc.text(VISA_BAND.x + CELL_PAD_X, VISA_BAND.y + 13.5, "VISAS ET APPROBATIONS", {
    size: 7,
    bold: true,
    color: LABEL_INK,
  });

  // The seven visa boxes, in printed order — left blank for signature.
  for (const v of AUTHORIZATION_VISA_BOXES) {
    doc.strokeRect(v.box.x, v.box.y, v.box.w, v.box.h, RULE, 0.7);
    doc.line(v.box.x, v.box.y + VISA_CAPTION_H, v.box.x + v.box.w, v.box.y + VISA_CAPTION_H, RULE_LIGHT, 0.5);
    doc.text(v.box.x + v.box.w / 2, v.box.y + 11, v.label, {
      size: 7,
      bold: true,
      align: "center",
      color: LABEL_INK,
    });
    // Name/date rule at the foot of the signing area.
    const ruleY = v.box.y + v.box.h - VISA_FOOT_RULE_OFFSET;
    doc.line(v.box.x + CELL_PAD_X, ruleY, v.box.x + v.box.w - CELL_PAD_X, ruleY, RULE_LIGHT, 0.5);
    doc.text(v.box.x + CELL_PAD_X, v.box.y + v.box.h - 8, "Nom / Date", { size: 5.5, color: LABEL_INK });
  }
}

/**
 * Layer 3 — one value in its cell. Steps the size down before truncating, and
 * returns false when the value still does not fit (reported, never hidden).
 */
function drawValue(doc: PdfDoc, field: TemplateField, text: string): boolean {
  if (!text) return true;

  const box = field.box;
  const innerW = box.w - CELL_PAD_X * 2;
  const start = field.size ?? VALUE_SIZE;

  if (field.multiline) {
    // The caption occupies the top of the cell; values start below it.
    const top = box.y + CELL_LABEL_DY + 4;
    const availableH = box.y + box.h - CELL_VALUE_DY - top;
    let size = start;
    let lines = wrap(text, innerW, size);
    while (size > MIN_VALUE_SIZE && lines.length * size * LINE_RATIO > availableH) {
      size -= 0.5;
      lines = wrap(text, innerW, size);
    }
    const maxLines = Math.max(1, Math.floor(availableH / (size * LINE_RATIO)));
    const fits = lines.length <= maxLines;
    const shown = fits ? lines : lines.slice(0, maxLines);
    shown.forEach((line, i) => {
      doc.text(box.x + CELL_PAD_X, top + (i + 1) * size * LINE_RATIO, line, { size, color: VALUE_INK });
    });
    return fits;
  }

  let size = start;
  while (size > MIN_VALUE_SIZE && textWidth(text, size) > innerW) size -= 0.5;

  const baseline = box.y + box.h - CELL_VALUE_DY;
  if (textWidth(text, size) <= innerW) {
    const x = field.align === "right" ? box.x + box.w - CELL_PAD_X : box.x + CELL_PAD_X;
    doc.text(x, baseline, text, { size, color: VALUE_INK, align: field.align === "right" ? "right" : "left" });
    return true;
  }

  // Still too wide at the minimum size — clip visibly and report it.
  let cut = text.length;
  while (cut > 1 && textWidth(`${text.slice(0, cut)}…`, size) > innerW) cut--;
  doc.text(box.x + CELL_PAD_X, baseline, `${text.slice(0, cut)}…`, { size, color: VALUE_INK });
  return false;
}

// ------------------------------------------------------------------ build --

/** The ACTIVE registered template version for the Autorisation, if any. */
export function activeAuthorizationTemplate() {
  return EXPENSE_TEMPLATES.find((t) => t.code === "EXPENSE_AUTHORIZATION" && t.status === "ACTIVE") ?? null;
}

/** Whether a raster background is registered (false today — the asset is outstanding). */
export function hasTemplateRaster(): ExpenseTemplateBackground | null {
  return activeAuthorizationTemplate()?.background ?? null;
}

/**
 * Render the Autorisation de Dépenses. `raster` supplies layer 1 when the master
 * asset exists; omitted (today) the drawn chrome stands in at the identical
 * coordinates.
 */
export function buildAuthorizationPdf(model: AuthorizationPrintModel, raster?: TemplateRaster): RenderResult {
  const doc = new PdfDoc({ size: "A4", orientation: "portrait" });

  const usedTemplateRaster = Boolean(raster);
  if (raster) drawBackground(doc, raster);
  else drawChrome(doc, model.companyName);

  // Status is a VALUE (it varies per document), so it rides layer 3 even when the
  // original page supplies the rest of the band. No watermark in 11.0C (DEC-C17
  // is 11.0D scope) — the status is stated plainly instead of decorated.
  doc.text(TITLE_BOX.x + TITLE_BOX.w - CELL_PAD_X - 2, TITLE_BOX.y + 15, model.statusLabel.toUpperCase(), {
    size: 8,
    bold: true,
    align: "right",
    color: LABEL_INK,
  });

  const overflowedFields: AuthorizationFieldKey[] = [];
  for (const field of AUTHORIZATION_FIELDS) {
    if (!drawValue(doc, field, valueFor(field.key, model))) overflowedFields.push(field.key);
  }

  return { bytes: doc.toBytes(), overflowedFields, usedTemplateRaster };
}

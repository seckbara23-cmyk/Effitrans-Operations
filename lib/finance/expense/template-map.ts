/**
 * Autorisation de Dépenses — template GEOMETRY (Phase 11.0C). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The coordinate map 11.0A §10 reserved for this phase: every printed box of the
 * paper form, in A4 points, top-left origin — the exact space `PdfDoc` draws in.
 *
 * WHY THIS IS A SEPARATE DATA MODULE (DEC-C16, Option A):
 * The approved strategy is « original-page raster background + coordinate
 * overlays ». The master template asset is NOT in the repository (11.0A §8 named
 * it the first 11.0B prerequisite; it was never committed — recorded as the
 * open conflict in docs/finance/phase-11.0c-expense-authorization.md). So the
 * renderer draws in THREE layers:
 *
 *   1. background  — the registered raster of the original form (ABSENT today;
 *                    `ExpenseTemplateVersion.background` is the slot)
 *   2. chrome      — frame, ruled boxes, labels and the visa grid, drawn from
 *                    THIS map, standing in for the scan until it lands
 *   3. values      — the document's data, drawn from THIS SAME map
 *
 * The consequence that matters: layers 2 and 3 read identical coordinates. When
 * the scan is committed, registering it turns layer 1 on and layer 2 off — and
 * NOT ONE value coordinate moves. Recalibrating against the real form is then a
 * data edit in this file, never a change to the renderer or the document code.
 *
 * Geometry is COMPUTED from the page constants (never hand-typed decimals) so
 * rows and columns always tile the frame exactly, with no cumulative drift.
 */

// ========================================================== page + frame ==

/** A4 portrait, in points (1/72"). Matches PdfDoc's A4. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

const MARGIN = 36;

/** The outer ruled frame of the form. */
export const FRAME = {
  x: MARGIN,
  y: MARGIN,
  w: PAGE_WIDTH - MARGIN * 2, // 523.28
  h: 770,
} as const;

const X0 = FRAME.x;
const W = FRAME.w;

/** Column splitters — computed, so N columns always sum to the full width. */
function cols(n: number): { x: number; w: number }[] {
  const w = W / n;
  return Array.from({ length: n }, (_, i) => ({ x: X0 + i * w, w }));
}

/** Explicit-weight columns (e.g. 2/1/3 of the width). */
function weighted(...weights: number[]): { x: number; w: number }[] {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = X0;
  return weights.map((weight) => {
    const w = (W * weight) / total;
    const out = { x, w };
    x += w;
    return out;
  });
}

// ================================================================= types ==

export type TemplateBox = { x: number; y: number; w: number; h: number };

/**
 * One printed cell of the form. `label` is the pre-printed caption (chrome
 * layer); `key` is the stable slot the value layer fills. A key is NEVER renamed
 * — the coordinate map is versioned template metadata.
 */
export type TemplateField = {
  key: AuthorizationFieldKey;
  label: string;
  box: TemplateBox;
  /** Wraps across the cell's inner height instead of a single baseline. */
  multiline?: boolean;
  align?: "left" | "right";
  /** Value font size; the renderer steps DOWN from here to avoid clipping. */
  size?: number;
};

export type TemplateVisaBox = {
  code: string;
  ordinal: number;
  /** The caption printed in the box, exactly as on the paper form. */
  label: string;
  box: TemplateBox;
};

/** Every value slot of the Autorisation. Mirrors the 11.0A §11 field catalog. */
export type AuthorizationFieldKey =
  | "authorization_number"
  | "document_date"
  | "account_number"
  | "file_number"
  | "registration_number"
  | "expense_type"
  | "weight_kg"
  | "beneficiary"
  | "amount"
  | "currency"
  | "agent_name"
  | "amount_in_words"
  | "reason"
  | "attachments"
  | "requested_by";

// ============================================================= row plan ==

/** Sequential row cursor — each row starts where the previous one ended. */
let cursor = FRAME.y;
const row = (h: number): number => {
  const y = cursor;
  cursor += h;
  return y;
};

const TITLE_H = 56;
const FIELD_H = 36;
const WORDS_H = 40;
const REASON_H = 110;
const ATTACH_H = 90;
const VISA_BAND_H = 20;

/** The title band: form name, and the document's status line. */
export const TITLE_BOX: TemplateBox = { x: X0, y: row(TITLE_H), w: W, h: TITLE_H };

const yIdentity = row(FIELD_H); // N° autorisation | Date
const yAccount = row(FIELD_H); // N° compte      | N° dossier
const yCargo = row(FIELD_H); // N° immat | Type | Poids
const yBeneficiary = row(FIELD_H); // Bénéficiaire
const yAmount = row(FIELD_H); // Montant | Devise | Nom de l'agent
const yWords = row(WORDS_H); // Montant en lettres
const yReason = row(REASON_H); // Observations / Motif
const yAttach = row(ATTACH_H); // Pièces jointes
const yRequested = row(FIELD_H); // Demandé par

/** The « VISAS ET APPROBATIONS » caption strip above the signature grid. */
export const VISA_BAND: TemplateBox = { x: X0, y: row(VISA_BAND_H), w: W, h: VISA_BAND_H };

const halves = cols(2);
const thirds = cols(3);
const amountCols = weighted(2, 1, 3); // Montant | Devise | Nom de l'agent

export const AUTHORIZATION_FIELDS: readonly TemplateField[] = [
  { key: "authorization_number", label: "N° AUTORISATION", box: { ...halves[0], y: yIdentity, h: FIELD_H }, size: 11 },
  { key: "document_date", label: "DATE", box: { ...halves[1], y: yIdentity, h: FIELD_H } },

  { key: "account_number", label: "N° COMPTE", box: { ...halves[0], y: yAccount, h: FIELD_H } },
  { key: "file_number", label: "N° DOSSIER", box: { ...halves[1], y: yAccount, h: FIELD_H } },

  { key: "registration_number", label: "N° IMMATRICULATION", box: { ...thirds[0], y: yCargo, h: FIELD_H } },
  { key: "expense_type", label: "TYPE", box: { ...thirds[1], y: yCargo, h: FIELD_H } },
  { key: "weight_kg", label: "POIDS (KG)", box: { ...thirds[2], y: yCargo, h: FIELD_H }, align: "right" },

  { key: "beneficiary", label: "BÉNÉFICIAIRE", box: { x: X0, y: yBeneficiary, w: W, h: FIELD_H }, size: 11 },

  { key: "amount", label: "MONTANT", box: { ...amountCols[0], y: yAmount, h: FIELD_H }, align: "right", size: 12 },
  { key: "currency", label: "DEVISE", box: { ...amountCols[1], y: yAmount, h: FIELD_H } },
  { key: "agent_name", label: "NOM DE L'AGENT", box: { ...amountCols[2], y: yAmount, h: FIELD_H } },

  { key: "amount_in_words", label: "MONTANT EN LETTRES", box: { x: X0, y: yWords, w: W, h: WORDS_H }, multiline: true },

  { key: "reason", label: "OBSERVATIONS / MOTIF", box: { x: X0, y: yReason, w: W, h: REASON_H }, multiline: true },
  { key: "attachments", label: "PIÈCES JOINTES", box: { x: X0, y: yAttach, w: W, h: ATTACH_H }, multiline: true },

  { key: "requested_by", label: "DEMANDÉ PAR", box: { x: X0, y: yRequested, w: W, h: FIELD_H } },
];

// ========================================================== visa grid ==

/**
 * The seven visa boxes, in the order PRINTED on the form (11.0A §6, DEC-C08):
 * Demandeur → Chef de Transit → Coordonnateur → Opération → Trésorière → DAF →
 * DG. Laid out 4 + 3 so each box keeps a usable signing area at A4; the ordinals
 * run left-to-right, top-to-bottom, preserving the paper order exactly.
 *
 * The boxes render EMPTY in 11.0C — no visa is written until 11.0D, and the form
 * is signed by hand in the meantime, exactly as the paper one is today.
 */
const VISA_LABELS: { code: string; label: string }[] = [
  { code: "VISA_DEMANDEUR", label: "Visa Demandeur" },
  { code: "VISA_CHEF_TRANSIT", label: "Chef de Transit" },
  { code: "VISA_COORDONNATEUR", label: "Coordonnateur" },
  { code: "VISA_OPERATIONS", label: "Opération" },
  { code: "VISA_TRESORIERE", label: "Trésorière" },
  { code: "VISA_DAF", label: "DAF" },
  { code: "VISA_DG", label: "DG" },
];

const VISA_ROW_1 = 4; // cells in the first visa row
const visaTop = cursor;
const visaRowH = (FRAME.y + FRAME.h - visaTop) / 2; // two rows fill the frame exactly
const visaCols1 = cols(VISA_ROW_1);
const visaCols2 = cols(VISA_LABELS.length - VISA_ROW_1);

export const AUTHORIZATION_VISA_BOXES: readonly TemplateVisaBox[] = VISA_LABELS.map((v, i) => {
  const first = i < VISA_ROW_1;
  const col = first ? visaCols1[i] : visaCols2[i - VISA_ROW_1];
  return {
    code: v.code,
    ordinal: i + 1,
    label: v.label,
    box: { x: col.x, y: first ? visaTop : visaTop + visaRowH, w: col.w, h: visaRowH },
  };
});

/** Inner metrics of a visa box: caption strip on top, name/date rule at the foot. */
export const VISA_CAPTION_H = 16;
export const VISA_FOOT_RULE_OFFSET = 22;

/** Cell padding: label baseline from the top, value baseline from the bottom. */
export const CELL_LABEL_DY = 11;
export const CELL_VALUE_DY = 10;
export const CELL_PAD_X = 6;

/** The whole geometry as one object — what the template registry version points at. */
export const AUTHORIZATION_GEOMETRY = {
  page: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
  frame: FRAME,
  title: TITLE_BOX,
  visaBand: VISA_BAND,
  fields: AUTHORIZATION_FIELDS,
  visas: AUTHORIZATION_VISA_BOXES,
} as const;

/** Lookup a field slot by key (the renderer's only accessor). */
export function fieldSlot(key: AuthorizationFieldKey): TemplateField | null {
  return AUTHORIZATION_FIELDS.find((f) => f.key === key) ?? null;
}

/**
 * Structural self-check used by the tests: every box sits inside the frame and no
 * two boxes of the same row overlap. A miscalibrated map is a printing defect, so
 * it is asserted rather than trusted.
 */
export function geometryIsWellFormed(): boolean {
  const inside = (b: TemplateBox) =>
    b.x >= FRAME.x - 0.01 &&
    b.y >= FRAME.y - 0.01 &&
    b.x + b.w <= FRAME.x + FRAME.w + 0.01 &&
    b.y + b.h <= FRAME.y + FRAME.h + 0.01;

  const boxes = [...AUTHORIZATION_FIELDS.map((f) => f.box), ...AUTHORIZATION_VISA_BOXES.map((v) => v.box), TITLE_BOX, VISA_BAND];
  if (!boxes.every(inside)) return false;

  // No two boxes overlap (they may share edges).
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap =
        a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
      if (overlap) return false;
    }
  }
  return true;
}

/**
 * Official invoice renderer (UAT-2B) — PURE. No I/O, no clock, no randomness.
 * ---------------------------------------------------------------------------
 * Renders THE accounting document: Effitrans' own service invoice, carrying the
 * official EFT-INV number.
 *
 * DETERMINISTIC BY CONSTRUCTION, and that is the whole point. The same snapshot
 * must always produce the same bytes, because the SHA-256 of those bytes is
 * what makes the artifact verifiable years later. So: no `new Date()`, no
 * `Math.random()`, no locale-dependent formatting that could drift with an
 * environment change. Every value comes from the snapshot the caller froze at
 * issuance.
 *
 * FABRICATES NOTHING. Tenant legal identifiers, bank details and addresses are
 * printed only when configured. A missing NINEA is simply absent — never a
 * placeholder, never an invented value. Invoices are used for tax and banking;
 * a plausible-looking wrong number is far worse than a visible omission.
 *
 * It also prints NO payment status. Version 1 is the invoice AS ISSUED and it
 * is never re-rendered; whether it has since been paid is application state,
 * shown in the app and the portal, not written back into an issued accounting
 * document.
 *
 * ===========================================================================
 * COORDINATES ARE TOP-DOWN (corrected 2026-07-31 — DEF-R10-05)
 * ===========================================================================
 * `PdfDoc` is a TOP-LEFT origin API: `y` is the distance from the TOP of the
 * page and GROWS DOWNWARD; the class converts to PDF's bottom-left space
 * internally (`py = this.height - y`). Every other renderer in the codebase
 * follows that contract — `lib/reports/templates.ts` does `this.y += h`,
 * `lib/copilot/export.ts` starts at the margin and increments.
 *
 * This renderer originally did the opposite: it started at `y = 800` and
 * DECREMENTED, as if y were measured from the bottom. On A4 (841.89 pt) the
 * first line therefore landed 41.89 pt from the BOTTOM and each step moved the
 * next element UPWARD — the invoice was built from the bottom of the page
 * toward the middle, in inverted order, with the top half blank.
 *
 * The layout below is the same design, expressed correctly: start at the top
 * margin, advance with `+=`. The spacing magnitudes are unchanged; only the
 * direction, the two column merge points, the header band anchor, the page
 * overflow guard and the totals rule anchor were corrected.
 *
 * ===========================================================================
 * WHY THE VERSION CONSTANT MOVES WITH IT
 * ===========================================================================
 * Correcting the geometry changes the bytes, and the bytes are the artifact:
 * their SHA-256 is what makes an issued invoice verifiable. Artifacts are
 * generated ONCE and are immutable (lib/finance/invoice-artifact.ts), so
 * invoices already issued keep their original bytes, their original hash AND
 * their original `renderer_version` — this correction reaches only invoices
 * issued from now on. The constant is what tells the two apart forever.
 */
import { PdfDoc, textWidth } from "@/lib/reports/pdf";
import { invoiceTotals } from "./calc";

/**
 * Renderer identity, recorded on every artifact at finalization.
 *
 *   uat2b-1  original release. Correct content, inverted geometry (DEF-R10-05).
 *   uat2b-2  2026-07-31 — geometry corrected to the top-down contract.
 *
 * Never reuse a version for different output: the whole point is that an
 * artifact can be traced to the exact renderer that produced its bytes.
 */
export const INVOICE_RENDERER_VERSION = "uat2b-2";

export type InvoiceSnapshotLine = {
  description: string;
  quantity: number;
  unitAmount: number;
  taxRate: number;
};

/** Everything the PDF may contain. Frozen at issuance; nothing else is read. */
export type InvoiceSnapshot = {
  // --- issuer identity (only what is configured) ---
  organizationName: string;
  organizationAddress?: string | null;
  organizationPhone?: string | null;
  organizationEmail?: string | null;
  /** NINEA / RC / tax identifiers, pre-formatted "label: value" pairs. */
  organizationIdentifiers?: readonly string[];
  /** Bank/payment details, pre-formatted lines. */
  paymentDetails?: readonly string[];

  // --- invoice identity ---
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;

  // --- customer + dossier ---
  customerName: string;
  customerAddress?: string | null;
  fileNumber: string;
  shipmentReference?: string | null;
  blAwbReference?: string | null;
  containerReference?: string | null;
  transportMode?: string | null;
  origin?: string | null;
  destination?: string | null;

  lines: readonly InvoiceSnapshotLine[];
};

const M = 40; // page margin
const NAVY: [number, number, number] = [0.05, 0.11, 0.23];
const GREY: [number, number, number] = [0.45, 0.45, 0.45];
const LINE: [number, number, number] = [0.85, 0.85, 0.85];

/**
 * Money, formatted deterministically. `Intl` is deliberately avoided: its
 * output depends on the ICU build, so the same snapshot could hash differently
 * on two runtimes — which would destroy the point of the hash.
 */
export function formatMoney(n: number, currency: string): string {
  const neg = n < 0;
  const cents = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = frac === 0 ? grouped : `${grouped},${String(frac).padStart(2, "0")}`;
  return `${neg ? "-" : ""}${body} ${currency}`;
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

export function renderOfficialInvoice(snapshot: InvoiceSnapshot): Uint8Array {
  const doc = new PdfDoc({ size: "A4" });
  const W = 595.28;
  const H = doc.height;
  // TOP-DOWN: y is the distance from the top of the page and grows downward.
  let y = M;

  // ---- issuer -------------------------------------------------------------
  doc.text(M, y, snapshot.organizationName, { size: 16, bold: true, color: NAVY });
  y += 16;
  for (const v of [
    clean(snapshot.organizationAddress),
    clean(snapshot.organizationPhone),
    clean(snapshot.organizationEmail),
    ...(snapshot.organizationIdentifiers ?? []).map(clean),
  ]) {
    if (!v) continue; // configured only — never invented
    doc.text(M, y, v, { size: 8, color: GREY });
    y += 10;
  }

  // ---- invoice identity (right) ------------------------------------------
  let ry = M;
  doc.text(W - M, ry, "FACTURE", { size: 18, bold: true, color: NAVY, align: "right" });
  ry += 20;
  doc.text(W - M, ry, snapshot.invoiceNumber, { size: 12, bold: true, align: "right" });
  ry += 14;
  doc.text(W - M, ry, `Date d'émission : ${snapshot.issueDate}`, { size: 9, color: GREY, align: "right" });
  ry += 11;
  if (snapshot.dueDate) {
    doc.text(W - M, ry, `Échéance : ${snapshot.dueDate}`, { size: 9, color: GREY, align: "right" });
    ry += 11;
  }

  // Two columns were written in parallel; continue below the LOWER of the two,
  // which top-down is the LARGER y.
  y = Math.max(y, ry) + 18;

  // ---- customer + dossier -------------------------------------------------
  doc.line(M, y, W - M, y, LINE);
  y += 16;
  const leftTop = y;
  doc.text(M, y, "Facturé à", { size: 8, bold: true, color: GREY });
  y += 12;
  doc.text(M, y, snapshot.customerName, { size: 10, bold: true });
  y += 12;
  const addr = clean(snapshot.customerAddress);
  if (addr) {
    doc.text(M, y, addr, { size: 9, color: GREY });
    y += 11;
  }

  let dy = leftTop;
  const dossier: string[] = [`Dossier : ${snapshot.fileNumber}`];
  for (const [label, v] of [
    ["Référence", snapshot.shipmentReference],
    ["BL / LTA", snapshot.blAwbReference],
    ["Conteneur", snapshot.containerReference],
    ["Mode", snapshot.transportMode],
  ] as const) {
    const c = clean(v);
    if (c) dossier.push(`${label} : ${c}`);
  }
  const o = clean(snapshot.origin);
  const d = clean(snapshot.destination);
  if (o && d) dossier.push(`Trajet : ${o} → ${d}`);
  else if (o) dossier.push(`Origine : ${o}`);
  else if (d) dossier.push(`Destination : ${d}`);

  for (const l of dossier) {
    doc.text(W - M, dy, l, { size: 9, color: GREY, align: "right" });
    dy += 11;
  }

  y = Math.max(y, dy) + 14;

  // ---- lines --------------------------------------------------------------
  const COL_Q = W - M - 210;
  const COL_U = W - M - 130;
  const COL_T = W - M;

  // The band sits BEHIND the header baseline: top-left origin, so its top edge
  // is above the baseline and it extends downward past the descenders.
  doc.fillRect(M, y - 14, W - 2 * M, 18, [0.96, 0.97, 0.98]);
  doc.text(M + 4, y, "Désignation", { size: 8, bold: true, color: NAVY });
  doc.text(COL_Q, y, "Qté", { size: 8, bold: true, color: NAVY, align: "right" });
  doc.text(COL_U, y, "P.U.", { size: 8, bold: true, color: NAVY, align: "right" });
  doc.text(COL_T, y, "Montant", { size: 8, bold: true, color: NAVY, align: "right" });
  y += 20;

  const cur = snapshot.currency;
  for (const l of snapshot.lines) {
    // Overflow: break when the cursor comes within 140 pt of the page bottom,
    // and restart the next page at the TOP margin.
    if (y > H - 140) {
      doc.addPage();
      y = M;
    }
    // Truncate rather than wrap: deterministic width, no reflow surprises.
    let desc = l.description;
    while (textWidth(desc, 9) > COL_Q - M - 14 && desc.length > 4) {
      desc = desc.slice(0, -2);
    }
    if (desc !== l.description) desc = `${desc}…`;

    doc.text(M + 4, y, desc, { size: 9 });
    doc.text(COL_Q, y, String(l.quantity), { size: 9, align: "right" });
    doc.text(COL_U, y, formatMoney(l.unitAmount, cur), { size: 9, align: "right" });
    doc.text(COL_T, y, formatMoney(l.quantity * l.unitAmount, cur), { size: 9, align: "right" });
    y += 8;
    doc.line(M, y, W - M, y, LINE);
    y += 12;
  }

  // ---- totals — the SAME function Finance and the portal use --------------
  const { subtotal, tax, total } = invoiceTotals(
    snapshot.lines.map((l) => ({ quantity: l.quantity, unitAmount: l.unitAmount, taxRate: l.taxRate })),
  );

  y += 6;
  const rows: [string, string, boolean][] = [
    ["Sous-total", formatMoney(subtotal, cur), false],
    ["TVA", formatMoney(tax, cur), false],
    ["TOTAL", formatMoney(total, cur), true],
  ];
  for (const [label, value, bold] of rows) {
    if (bold) {
      // The rule sits ABOVE the TOTAL row — top-down, above is the smaller y.
      doc.line(COL_U - 60, y - 12, COL_T, y - 12, LINE);
      y += 2;
    }
    doc.text(COL_U, y, label, { size: bold ? 10 : 9, bold, color: bold ? NAVY : GREY, align: "right" });
    doc.text(COL_T, y, value, { size: bold ? 11 : 9, bold, color: bold ? NAVY : [0, 0, 0], align: "right" });
    y += bold ? 16 : 13;
  }

  // ---- payment details (configured only) ----------------------------------
  const pay = (snapshot.paymentDetails ?? []).map(clean).filter((v): v is string => Boolean(v));
  if (pay.length > 0) {
    y += 10;
    doc.text(M, y, "Coordonnées de règlement", { size: 8, bold: true, color: NAVY });
    y += 12;
    for (const l of pay) {
      doc.text(M, y, l, { size: 8, color: GREY });
      y += 10;
    }
  }

  return doc.toBytes();
}

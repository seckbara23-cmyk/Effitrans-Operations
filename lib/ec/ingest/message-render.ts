/**
 * CEO-ALIGNMENT WP1-D — the customer's instructing e-mail, rendered to PDF.
 * PURE: no I/O, no clock, no network, no DOM. Server + test safe.
 * ---------------------------------------------------------------------------
 * CEO-004: « … ou rattacher le mail du client qui confie le dossier a
 * Effitrans. »
 *
 * WHAT THIS PRODUCES. A faithful, readable rendition of a CAPTURED message —
 * its envelope (sender, recipients, date, subject, Message-ID), the SHA-256 of
 * the original raw message, the names of its attachments, and the text of its
 * body. It is evidence ABOUT the message, filed on the dossier; the original
 * `.eml` stays untouched in EC-1's immutable capture, and the printed hash is
 * how anyone can tie this page back to those exact bytes.
 *
 * SAFE BY CONSTRUCTION.
 *   * TEXT ONLY. An HTML body is reduced to text by string operations here:
 *     scripts, styles and the document head are dropped with their content,
 *     tags are stripped, entities decoded. Nothing is ever fetched — no image,
 *     no stylesheet, no tracking pixel — because nothing here can fetch.
 *   * DETERMINISTIC. The same inputs give the same bytes: no `Date.now()`, no
 *     random identifiers. The only date printed is the message's own.
 *   * BOUNDED. The body is capped, and the cap is stated on the page rather
 *     than silently applied.
 *   * NOT A VERDICT. The page says what the platform received. It does not say
 *     the instruction is genuine, complete or accepted — that is the ordinary
 *     document verification a person performs afterwards.
 */
import { PdfDoc, textWidth, type RGB } from "@/lib/reports/pdf";

export const MESSAGE_RENDERER_VERSION = "wp1d-2";
/** Characters of body text rendered; beyond this the page says so. */
export const MAX_BODY_CHARS = 20_000;
/**
 * Wrapped lines of body text rendered (about 27 A4 pages). 20 000 characters
 * of ordinary prose wrap to a few hundred lines; only a pathological body (a
 * character per line) reaches this, and the page then says it was cut.
 */
export const MAX_BODY_LINES = 1_500;
/** Characters of any one header value (sender, recipients, subject, attachments). */
export const MAX_FIELD_CHARS = 2_000;

export type MessageRenderInput = {
  fileNumber: string | null;
  fromAddress: string;
  fromName: string | null;
  to: readonly string[];
  cc: readonly string[];
  subject: string | null;
  /** ISO instant the provider delivered the message. */
  receivedAt: string;
  messageIdHeader: string | null;
  /** SHA-256 of the original raw message, as recorded at capture. */
  rawSha256: string;
  /** Plain-text body, when the message had one. */
  textBody: string | null;
  /** HTML body, used only when there is no text body. Never rendered as HTML. */
  htmlBody: string | null;
  attachments: readonly { filename: string; sizeBytes: number }[];
};

// ---------------------------------------------------------------- text ----

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç",
  ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", iuml: "ï", euml: "ë",
  Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç", laquo: "«", raquo: "»",
  euro: "€", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—", bull: "•",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      // Refuse control characters and out-of-range code points rather than
      // reproducing them; a replacement keeps the text's shape.
      if (!Number.isFinite(n) || n < 0x20 || n > 0x10ffff) return " ";
      return String.fromCodePoint(n);
    }
    return ENTITIES[code] ?? m;
  });
}

/**
 * HTML → plain text, by string operations only. Drops `<script>`, `<style>`,
 * `<head>` and comments WITH their content, turns block boundaries into line
 * breaks, strips every remaining tag, decodes entities.
 */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|head|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(script|style|head|noscript|template)\b[^>]*\/?>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table|ul|ol)\s*>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "• ");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  return normalizeText(s);
}

/** Line endings normalised, control characters removed, blank runs collapsed. */
export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The body actually printed: text if present, else HTML reduced to text. */
export function bodyFor(input: Pick<MessageRenderInput, "textBody" | "htmlBody">): {
  text: string;
  source: "text" | "html" | "none";
  truncated: boolean;
} {
  const raw = input.textBody && input.textBody.trim() !== ""
    ? { text: normalizeText(input.textBody), source: "text" as const }
    : input.htmlBody && input.htmlBody.trim() !== ""
      ? { text: htmlToText(input.htmlBody), source: "html" as const }
      : { text: "", source: "none" as const };
  if (raw.text.length <= MAX_BODY_CHARS) return { ...raw, truncated: false };
  return { text: raw.text.slice(0, MAX_BODY_CHARS), source: raw.source, truncated: true };
}

/**
 * A string's advance in thousandths of an em — the integer `textWidth` sums
 * before scaling. Widths are additive per character, so a prefix's width is a
 * running sum and never needs re-measuring.
 */
function advance(s: string): number {
  return Math.round(textWidth(s, 1000));
}

/**
 * Greedy word wrap to a width in points, breaking over-long words. LINEAR in
 * the line's length: each word is measured once and a token wider than the
 * line is hard-broken in a single pass. The previous version re-measured the
 * remainder after every one-character step — cubic, 42 s of CPU for one
 * 20 000-character token (AUDIT-HARDENING-01, F-2). Same lines out, byte for
 * byte: the comparison below is textWidth's own arithmetic on the same sums.
 */
export function wrapLine(line: string, maxWidth: number, size: number): string[] {
  if (line === "") return [""];
  const fits = (units: number) => (units / 1000) * size <= maxWidth;
  const out: string[] = [];
  let current = "";
  let currentUnits = 0;
  for (const word of line.split(/(\s+)/)) {
    if (word === "") continue;
    const wordUnits = advance(word);
    if (fits(currentUnits + wordUnits)) {
      current += word;
      currentUnits += wordUnits;
      continue;
    }
    if (current.trim() !== "") out.push(current.trimEnd());
    // A single token wider than the line (a URL, a hash) is hard-broken: each
    // piece takes as many characters as fit, and at least one.
    const rest = word.trimStart();
    let start = 0;
    let units = 0;
    for (let i = 0; i < rest.length; i++) {
      const u = advance(rest[i]);
      if (i > start && !fits(units + u)) {
        out.push(rest.slice(start, i));
        start = i;
        units = 0;
      }
      units += u;
    }
    current = rest.slice(start);
    currentUnits = units;
  }
  if (current.trim() !== "" || out.length === 0) out.push(current.trimEnd());
  return out;
}

/** A header value, bounded: the page says when it was cut. */
export function capField(value: string): string {
  return value.length <= MAX_FIELD_CHARS ? value : `${value.slice(0, MAX_FIELD_CHARS)} … [tronqué]`;
}

/** UTC, minute precision, never locale- or clock-dependent. */
export function utcStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// ---------------------------------------------------------------- page ----

const NAVY: RGB = [0.07, 0.15, 0.29];
const GREY: RGB = [0.4, 0.45, 0.5];
const INK: RGB = [0.1, 0.12, 0.15];

export function renderInstructionMessage(input: MessageRenderInput): Uint8Array {
  const doc = new PdfDoc({ size: "A4", orientation: "portrait" });
  const M = 48;
  const bottom = doc.height - M;
  const width = doc.width - 2 * M;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > bottom) {
      doc.addPage();
      y = M;
    }
  };
  // `budget` bounds the lines one paragraph may print; it reports whether it
  // ran out, so the caller can say so on the page.
  const para = (s: string, size: number, color: RGB, bold = false, lead = 1.35, budget = Infinity): boolean => {
    let left = budget;
    for (const raw of s.split("\n")) {
      for (const line of wrapLine(raw, width, size)) {
        if (left <= 0) return true;
        left--;
        ensure(size * lead);
        doc.text(M, y, line, { size, color, bold });
        y += size * lead;
      }
    }
    return false;
  };
  const field = (label: string, value: string) => para(`${label} : ${capField(value)}`, 9, INK);

  doc.text(M, y, "EFFITRANS — INSTRUCTION CLIENT (MESSAGE CAPTURÉ)", { size: 13, bold: true, color: NAVY });
  y += 20;
  if (input.fileNumber) {
    doc.text(M, y, `Dossier ${input.fileNumber}`, { size: 9, bold: true, color: NAVY });
    y += 16;
  }

  const sender = input.fromName ? `${input.fromName} <${input.fromAddress}>` : input.fromAddress;
  field("De", sender);
  field("À", input.to.length ? input.to.join(", ") : "—");
  if (input.cc.length) field("Cc", input.cc.join(", "));
  field("Reçu le", utcStamp(input.receivedAt));
  field("Objet", input.subject?.trim() ? input.subject : "(sans objet)");
  if (input.messageIdHeader) field("Message-ID", input.messageIdHeader);
  field("Empreinte SHA-256 du message original", input.rawSha256);
  field(
    "Pièces jointes",
    input.attachments.length
      ? input.attachments.map((a) => `${a.filename} (${formatSize(a.sizeBytes)})`).join(" ; ")
      : "aucune",
  );

  y += 6;
  ensure(12);
  doc.line(M, y, doc.width - M, y);
  y += 12;

  const body = bodyFor(input);
  if (body.source === "none") {
    para("(Le message ne contient pas de texte.)", 10, GREY);
  } else {
    if (body.source === "html") {
      para("Texte extrait de la version HTML du message (aucun contenu distant n'a été chargé).", 8, GREY);
      y += 4;
    }
    const cutByLines = para(body.text, 10, INK, false, 1.35, MAX_BODY_LINES);
    if (body.truncated || cutByLines) {
      y += 6;
      para(
        `[Texte tronqué (au plus ${MAX_BODY_CHARS} caractères et ${MAX_BODY_LINES} lignes). Le message original complet reste conservé dans la capture ; son empreinte figure ci-dessus.]`,
        8, GREY,
      );
    }
  }

  y += 10;
  para(
    "Rendu par la plateforme Effitrans à partir du message capturé (moteur " + MESSAGE_RENDERER_VERSION + "). " +
      "Ce document atteste ce qui a été reçu ; il ne vaut pas validation de l'instruction, qui suit la vérification documentaire habituelle.",
    7.5, GREY,
  );

  return doc.toBytes();
}

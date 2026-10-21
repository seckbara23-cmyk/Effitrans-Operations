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

export const MESSAGE_RENDERER_VERSION = "wp1d-1";
/** Characters of body text rendered; beyond this the page says so. */
export const MAX_BODY_CHARS = 20_000;

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

/** Greedy word wrap to a width in points, breaking over-long words. */
export function wrapLine(line: string, maxWidth: number, size: number): string[] {
  if (line === "") return [""];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(/(\s+)/)) {
    if (word === "") continue;
    const candidate = current + word;
    if (textWidth(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.trim() !== "") out.push(current.trimEnd());
    // A single token wider than the line (a URL, a hash) is hard-broken.
    let rest = word.trimStart();
    while (textWidth(rest, size) > maxWidth && rest.length > 1) {
      let cut = rest.length;
      while (cut > 1 && textWidth(rest.slice(0, cut), size) > maxWidth) cut--;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current.trim() !== "" || out.length === 0) out.push(current.trimEnd());
  return out;
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
  const para = (s: string, size: number, color: RGB, bold = false, lead = 1.35) => {
    for (const raw of s.split("\n")) {
      for (const line of wrapLine(raw, width, size)) {
        ensure(size * lead);
        doc.text(M, y, line, { size, color, bold });
        y += size * lead;
      }
    }
  };
  const field = (label: string, value: string) => para(`${label} : ${value}`, 9, INK);

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
    para(body.text, 10, INK);
    if (body.truncated) {
      y += 6;
      para(
        `[Texte tronqué à ${MAX_BODY_CHARS} caractères. Le message original complet reste conservé dans la capture ; son empreinte figure ci-dessus.]`,
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

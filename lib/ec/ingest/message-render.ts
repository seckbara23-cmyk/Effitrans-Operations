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

export const MESSAGE_RENDERER_VERSION = "wp1d-3";
/** Characters of body text rendered; beyond this the page says so. */
export const MAX_BODY_CHARS = 20_000;
/**
 * Characters of the stored body (text or HTML) read at all. Everything the
 * reduction does is linear, so this is defence in depth, not the fix: a
 * captured body can be up to the 25 MiB webhook limit, and nothing useful for a
 * 20 000-character rendition lies beyond the first half-million characters.
 */
export const MAX_SOURCE_CHARS = 500_000;
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
 *
 * LINEAR in the input (AUDIT-HARDENING N-1). The previous version was seven
 * regular-expression passes; on markup that never closes (`<a<a<a…`,
 * `<script ` repeated, `<!--` repeated) each pass restarted its search at every
 * `<` and scanned to the end — quadratic, 3 s for 100 KB of unclosed `<`
 * (measured). Here each pass is a single left-to-right scan with `indexOf`, and
 * a search that found nothing is never repeated. On well-formed HTML the result
 * is the same text as before. `beyondCut` is the unread rest of a body cut at
 * MAX_SOURCE_CHARS (see stripRawTextElements); tests/wp1-closure-hardening.test.ts
 * pins the literal `<`, the ASCII-only case folding and the cap's edge.
 */
export function htmlToText(html: string, beyondCut = ""): string {
  const uncommented = stripComments(html, beyondCut);
  // A comment that ran to the cut took the end of the text with it: what is
  // left no longer ends AT the cut, so the raw-text rule must not read a seam.
  const rest = uncommented.ranToCut ? "" : beyondCut;
  return normalizeText(decodeEntities(reduceTags(stripRawTextElements(uncommented.text, rest))));
}

/**
 * `<!-- … -->` removed. A comment that never closes stays as text, as before —
 * unless the source was cut and its `-->` lies past the cut (or is split by
 * it): then it runs to the cut and goes, as it did on the whole body.
 */
function stripComments(s: string, beyondCut: string): { text: string; ranToCut: boolean } {
  const out: string[] = [];
  let i = 0;
  let ranToCut = false;
  for (;;) {
    const open = s.indexOf("<!--", i);
    if (open < 0) break;
    const close = s.indexOf("-->", open + 4);
    if (close < 0) {
      // no comment ends in what was read, so none further can be removed here
      const seam = s.slice(Math.max(open + 4, s.length - 2)) + beyondCut.slice(0, 2);
      if (beyondCut !== "" && (seam.includes("-->") || beyondCut.includes("-->"))) {
        out.push(s.slice(i, open));
        i = s.length;
        ranToCut = true;
      }
      break;
    }
    out.push(s.slice(i, open));
    i = close + 3;
  }
  out.push(s.slice(i));
  return { text: out.join(""), ranToCut };
}

const RAW_TEXT_OPENER = /<(script|style|head|noscript|template)\b/gi;

/**
 * ASCII letters lower-cased, every other character untouched: the result has
 * the SAME LENGTH as the input, so an index found in it is an index in the
 * input. `toLowerCase()` does not have that property — « İ » (U+0130) becomes
 * two code units — and every « İ » before a `<style>` shifted the cut, eating
 * real text after it (closure security review, HIGH). Tag names are ASCII and
 * HTML matches them ASCII-case-insensitively, so this is also the right fold.
 */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/**
 * script/style/head/noscript/template removed WITH their content, up to the
 * end tag that closes them (closingTagEnd). An element that never closes
 * loses only its opening tag, as before — UNLESS the source was cut
 * (MAX_SOURCE_CHARS) and the element's closing tag lies beyond the cut
 * (`beyondCut` is the unread rest): then it runs to the cut and is removed,
 * which is what the reducer did on the whole body before the cap existed.
 * An element name found to have no closing tag left is never searched again,
 * and the unread rest is searched at most once per element name.
 */
function stripRawTextElements(s: string, beyondCut: string): string {
  const lower = asciiLower(s);
  const unclosed = new Set<string>();
  const closesInRest = new Map<string, boolean>();
  const out: string[] = [];
  const opener = new RegExp(RAW_TEXT_OPENER.source, "gi");
  let i = 0;
  for (let m = opener.exec(s); m !== null; m = opener.exec(s)) {
    const at = m.index;
    const name = m[1].toLowerCase();
    const end = unclosed.has(name) ? -1 : closingTagEnd(lower, name, at + 1 + name.length);
    if (end >= 0) {
      out.push(s.slice(i, at));
      i = opener.lastIndex = end;
      continue;
    }
    unclosed.add(name);
    if (beyondCut !== "" && closesBeyondCut(s, at, name, beyondCut, closesInRest)) {
      out.push(s.slice(i, at));
      i = s.length;
      break;
    }
    const gt = s.indexOf(">", at);
    if (gt < 0) break; // no '>' after here: nothing further can be a tag
    out.push(s.slice(i, at));
    i = opener.lastIndex = gt + 1;
  }
  out.push(s.slice(i));
  return out.join("");
}

/** Whitespace as the HTML tokenizer defines it — not JS `\s`, which also takes NBSP. */
const HTML_SPACE = /[\t\n\f\r ]/;

/**
 * Does the element opened at `at` close past the cut? Two bounded questions:
 * a closing tag SPLIT by the cut (the last 32 characters read + the first 32
 * unread), and one anywhere in the unread rest — searched once per element
 * name and remembered, so many unclosed openers never rescan it. Each search is
 * linear: `<\/name[\t\n\f\r />]` is a fixed-length pattern.
 */
function closesBeyondCut(
  s: string,
  at: number,
  name: string,
  beyondCut: string,
  closesInRest: Map<string, boolean>,
): boolean {
  const closer = new RegExp("<\\/" + name + "[\\t\\n\\f\\r />]", "i");
  if (closer.test(s.slice(Math.max(at + 1, s.length - 32)) + beyondCut.slice(0, 32))) return true;
  let inRest = closesInRest.get(name);
  if (inRest === undefined) {
    inRest = closer.test(beyondCut);
    closesInRest.set(name, inRest);
  }
  return inRest;
}

/**
 * Index just past the end tag that closes `name`, at or after `from`, or -1 —
 * read as the HTML tokenizer reads a raw-text element: `</name` followed by
 * `>`, `/` or HTML whitespace closes it, and the tag ends at the next `>`.
 * So `</style x>` closes (attributes on an end tag are an error browsers
 * ignore) and `</stylex>` or `</style` + NBSP does not. The previous rule,
 * `</name\s*>`, missed the first — letting a sender hide the prose after it
 * from the rendition while every mail client shows it — and accepted the last.
 * (Closure security re-review, LOW, pre-existing.)
 */
function closingTagEnd(lower: string, name: string, from: number): number {
  const needle = "</" + name;
  for (let at = lower.indexOf(needle, from); at >= 0; at = lower.indexOf(needle, at + 1)) {
    const next = lower.charAt(at + needle.length);
    if (next === ">") return at + needle.length + 1;
    if (next === "/" || HTML_SPACE.test(next)) {
      const gt = lower.indexOf(">", at + needle.length);
      return gt < 0 ? -1 : gt + 1; // no '>' left: nothing can close it
    }
  }
  return -1;
}

const BREAK_TAG = /^<br\s*\/?>$/i;
const BLOCK_END_TAG = /^<\/(p|div|li|tr|h[1-6]|blockquote|table|ul|ol)\s*>$/i;
const LIST_ITEM_TAG = /^<li\b/i;
const TAG_START = /[A-Za-z/!?]/;

/**
 * Every remaining tag, in one pass: a line break, a bullet, or nothing. As in
 * a browser, `<` opens a tag only when a letter, `/`, `!` or `?` follows it;
 * otherwise it is text (« a < b », « <3 ») and is kept — the previous version
 * deleted everything from such a `<` to the next `>`.
 */
function reduceTags(s: string): string {
  const out: string[] = [];
  let i = 0;
  let from = 0;
  for (;;) {
    const lt = s.indexOf("<", from);
    if (lt < 0) break;
    if (!TAG_START.test(s.charAt(lt + 1))) {
      from = lt + 1;
      continue;
    }
    const gt = s.indexOf(">", lt);
    if (gt < 0) break; // a '<' that never closes is text, as before
    out.push(s.slice(i, lt));
    const tag = s.slice(lt, gt + 1);
    if (BREAK_TAG.test(tag) || BLOCK_END_TAG.test(tag)) out.push("\n");
    else if (LIST_ITEM_TAG.test(tag)) out.push("• ");
    i = from = gt + 1;
  }
  out.push(s.slice(i));
  return out.join("");
}

/**
 * Line endings normalised, control characters removed, blank runs collapsed.
 * Trailing whitespace is cut with `trimEnd()` — the same characters `\s+$`
 * matched, without the regex restarting at every space of a long run
 * (quadratic, 1.2 s for 64 KB of spaces — on plain-text bodies too).
 */
export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((l) => l.trimEnd())
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
  // The stored body is read up to MAX_SOURCE_CHARS; past that, the page says so.
  const cap = (b: string) => (b.length > MAX_SOURCE_CHARS ? b.slice(0, MAX_SOURCE_CHARS) : b);
  const rest = (b: string) => (b.length > MAX_SOURCE_CHARS ? b.slice(MAX_SOURCE_CHARS) : "");
  const sourceCut =
    (input.textBody && input.textBody.trim() !== "" ? input.textBody : input.htmlBody ?? "").length > MAX_SOURCE_CHARS;
  const raw = input.textBody && input.textBody.trim() !== ""
    ? { text: normalizeText(cap(input.textBody)), source: "text" as const }
    : input.htmlBody && input.htmlBody.trim() !== ""
      ? { text: htmlToText(cap(input.htmlBody), rest(input.htmlBody)), source: "html" as const }
      : { text: "", source: "none" as const };
  if (raw.text.length <= MAX_BODY_CHARS) return { ...raw, truncated: sourceCut };
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
        `[Texte tronqué (au plus ${MAX_BODY_CHARS} caractères et ${MAX_BODY_LINES} lignes, lus dans les ${MAX_SOURCE_CHARS} premiers caractères du message). Le message original complet reste conservé dans la capture ; son empreinte figure ci-dessus.]`,
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

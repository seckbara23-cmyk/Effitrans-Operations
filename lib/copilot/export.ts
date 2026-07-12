/**
 * Copilot answer export (Phase 3.4F-3) — PURE, dependency-free. Client + server safe.
 * ---------------------------------------------------------------------------
 * Turns a Copilot answer into a downloadable artifact WITHOUT any new dependency:
 *   - PDF  : reuses the native dependency-free PDF writer (lib/reports/pdf).
 *   - Word : RTF (opens + edits in Word / LibreOffice) — no docx library.
 *   - Email: a .eml draft (RFC 822, X-Unsent) that opens in Outlook / Mail.
 * The client wraps the returned bytes/string in a Blob and downloads it; nothing
 * here touches the network or the filesystem. Unit-tested.
 */
import { PdfDoc, textWidth } from "@/lib/reports/pdf";

const DEFAULT_TITLE = "Réponse du Copilote Opérations";

/** Word-wrap `text` to `maxWidth` pt at font `size`, preserving explicit newlines. */
export function wrapText(text: string, maxWidth: number, size: number, bold = false): string[] {
  const out: string[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    if (raw.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of raw.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= maxWidth) {
        line = candidate;
      } else {
        if (line) out.push(line);
        if (textWidth(word, size, bold) > maxWidth) {
          // Hard-break a single over-long token.
          let chunk = "";
          for (const ch of word) {
            if (textWidth(chunk + ch, size, bold) <= maxWidth) chunk += ch;
            else {
              if (chunk) out.push(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        } else {
          line = word;
        }
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Render the answer as a valid PDF (A4). Returns the raw bytes. */
export function answerToPdfBytes(text: string, opts?: { title?: string; subtitle?: string }): Uint8Array {
  const doc = new PdfDoc({ size: "A4" });
  const M = 48;
  const size = 10;
  const lineHeight = 14;
  const maxW = doc.width - M * 2;
  let y = M + 6;

  doc.text(M, y, opts?.title ?? DEFAULT_TITLE, { size: 14, bold: true, color: [0.06, 0.09, 0.16] });
  y += 20;
  if (opts?.subtitle) {
    doc.text(M, y, opts.subtitle, { size: 9, color: [0.4, 0.45, 0.5] });
    y += 16;
  }
  doc.line(M, y, doc.width - M, y, [0.8, 0.8, 0.8]);
  y += 16;

  for (const line of wrapText(text, maxW, size)) {
    if (y > doc.height - M) {
      doc.addPage();
      y = M + 6;
    }
    if (line !== "") doc.text(M, y, line, { size });
    y += lineHeight;
  }
  return doc.toBytes();
}

/** RTF escaping: braces/backslash, newlines → \par, non-ASCII → \uN. */
function rtfEscape(s: string): string {
  let out = "";
  for (const ch of s ?? "") {
    if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (ch === "\n") out += "\\par\n";
    else if (ch === "\r") continue;
    else {
      const code = ch.codePointAt(0) ?? 0;
      out += code > 127 ? `\\u${code}?` : ch;
    }
  }
  return out;
}

/** Render the answer as an RTF document (Word-openable). */
export function answerToRtf(text: string, opts?: { title?: string }): string {
  const title = opts?.title ?? DEFAULT_TITLE;
  return (
    `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\n` +
    `\\fs28\\b ${rtfEscape(title)}\\b0\\par\n` +
    `\\fs22 ${rtfEscape(text)}\\par\n}`
  );
}

/** Base64 of a UTF-8 string (for RFC 2047 subject encoding). */
function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Render the answer as a .eml draft (RFC 822, marked unsent so clients open it as a draft). */
export function answerToEml(text: string, opts?: { subject?: string; to?: string }): string {
  const subject = opts?.subject ?? "Mise à jour dossier";
  const encSubject = /[^\x20-\x7E]/.test(subject) ? `=?UTF-8?B?${b64utf8(subject)}?=` : subject;
  const headers = [
    `To: ${opts?.to ?? ""}`,
    `Subject: ${encSubject}`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + (text ?? "").replace(/\r?\n/g, "\r\n");
}

/** Safe download filename stem, e.g. "copilote-EFT-IMP-2099-00001". */
export function exportFilename(base: string | null | undefined): string {
  const safe = (base ?? "dossier").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `copilote-${safe || "dossier"}`;
}

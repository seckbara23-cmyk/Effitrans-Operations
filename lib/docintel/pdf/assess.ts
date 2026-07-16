/**
 * Document Intelligence — searchable-PDF assessment (Phase 7.4B). PURE (no IO, no library).
 * Given the per-page text a local parser produced, decide the honest outcome:
 *   - too many pages / too large        → TOO_LARGE
 *   - no extractable text layer (image) → OCR_REQUIRED  (scanned PDF; we do NOT do OCR)
 *   - otherwise                         → searchable: bounded, page-preserving text
 * Separated from the parser so the limits + scanned-detection logic are unit-testable without
 * invoking any PDF library. Document text is untrusted DATA (never instructions).
 */

export const PDF_LIMITS = {
  /** Reject files above this size before parsing (bytes). */
  MAX_BYTES: 26_214_400, // 25 MiB
  /** Reject documents with more pages than this. */
  MAX_PAGES: 100,
  /** Hard cap on total extracted characters retained (page boundaries preserved). */
  MAX_TEXT_CHARS: 200_000,
  /** Below this many non-whitespace chars across the whole document ⇒ no text layer ⇒ OCR_REQUIRED. */
  MIN_TEXT_CHARS_SEARCHABLE: 24,
  /** Wall-clock budget for a single parse (ms). */
  TIMEOUT_MS: 15_000,
} as const;

export type PdfFailureCode =
  | "TOO_LARGE"
  | "TIMEOUT"
  | "OCR_REQUIRED"
  | "UNSUPPORTED_FILE"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE";

export type PdfAssessment =
  | { ok: true; pages: string[]; pageCount: number; charCount: number; truncated: boolean }
  | { ok: false; code: PdfFailureCode };

function nonWhitespaceLength(s: string): number {
  return s.replace(/\s+/g, "").length;
}

/**
 * Decide searchable-vs-scanned + enforce page/text limits over already-parsed page text.
 * Preserves page boundaries; truncates (never silently drops) when the total exceeds the cap.
 */
export function assessExtractedPdf(input: { pages: string[]; pageCount: number; byteSize?: number | null }): PdfAssessment {
  const byteSize = input.byteSize ?? null;
  if (byteSize != null && byteSize > PDF_LIMITS.MAX_BYTES) return { ok: false, code: "TOO_LARGE" };

  const pageCount = Number.isFinite(input.pageCount) ? Math.max(0, Math.trunc(input.pageCount)) : 0;
  if (pageCount > PDF_LIMITS.MAX_PAGES) return { ok: false, code: "TOO_LARGE" };

  const rawPages = (input.pages ?? []).map((p) => String(p ?? ""));
  const totalNonWs = rawPages.reduce((n, p) => n + nonWhitespaceLength(p), 0);
  // A scanned / image-only PDF yields (essentially) no text layer — we do not OCR here.
  if (totalNonWs < PDF_LIMITS.MIN_TEXT_CHARS_SEARCHABLE) return { ok: false, code: "OCR_REQUIRED" };

  // Retain page boundaries while enforcing the total-character cap.
  const pages: string[] = [];
  let used = 0;
  let truncated = false;
  for (const p of rawPages) {
    if (used >= PDF_LIMITS.MAX_TEXT_CHARS) { truncated = true; break; }
    const remaining = PDF_LIMITS.MAX_TEXT_CHARS - used;
    if (p.length > remaining) { pages.push(p.slice(0, remaining)); used += remaining; truncated = true; }
    else { pages.push(p); used += p.length; }
  }
  return { ok: true, pages, pageCount, charCount: used, truncated };
}

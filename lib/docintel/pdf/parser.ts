/**
 * Document Intelligence — searchable-PDF parser adapter (Phase 7.4B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ENTIRELY LOCAL. Extracts the EMBEDDED text layer of a searchable PDF using pdf-parse
 * (a pure-Node library that bundles its own pdf.js). NO OCR, NO LLM, NO network, NO external
 * call — the document bytes never leave the server. A scanned / image-only PDF has no text
 * layer and returns OCR_REQUIRED (we never claim to read scanned pages).
 *
 * Boundaries enforced here: MIME must be application/pdf, byte-size + page-count limits, a
 * wall-clock timeout, and page-boundary-preserving text. The scanned-vs-searchable decision and
 * text caps live in the PURE assessor (./assess) so they are unit-testable without a PDF.
 */
import "server-only";
import { assessExtractedPdf, PDF_LIMITS, type PdfAssessment } from "./assess";

type PageData = { getTextContent(opts?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<{ items: Array<{ str: string; transform: number[] }> }> };

/** Capture each page's text separately so page boundaries + provenance survive. */
function pageRenderer(pages: string[]) {
  return async (pageData: PageData) => {
    const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    let lastY: number | undefined;
    let text = "";
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY === undefined || lastY === y) text += item.str;
      else text += "\n" + item.str;
      lastY = y;
    }
    pages.push(text);
    return text; // pdf-parse also concatenates this into result.text
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PDF_PARSE_TIMEOUT")), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Parse a searchable PDF into page-preserving text, or a bounded failure code. Never throws a
 * raw library error to the caller — every failure is mapped to a closed vocabulary code.
 */
export async function parseSearchablePdf(bytes: Buffer, opts: { mimeType?: string | null; byteSize?: number | null } = {}): Promise<PdfAssessment> {
  if (opts.mimeType && opts.mimeType !== "application/pdf") return { ok: false, code: "UNSUPPORTED_FILE" };
  if (!bytes || bytes.length === 0) return { ok: false, code: "UNSUPPORTED_FILE" };
  const byteSize = opts.byteSize ?? bytes.length;
  if (byteSize > PDF_LIMITS.MAX_BYTES) return { ok: false, code: "TOO_LARGE" };

  const pages: string[] = [];
  let result: { numpages: number };
  try {
    // Import the inner module directly to bypass pdf-parse's debug-mode test-file read.
    const { default: pdf } = await import("pdf-parse/lib/pdf-parse.js");
    result = await withTimeout(
      pdf(bytes, { max: PDF_LIMITS.MAX_PAGES + 1, pagerender: pageRenderer(pages) }),
      PDF_LIMITS.TIMEOUT_MS,
    );
  } catch (e) {
    return { ok: false, code: e instanceof Error && e.message === "PDF_PARSE_TIMEOUT" ? "TIMEOUT" : "PROVIDER_ERROR" };
  }

  const pageCount = Number.isFinite(result?.numpages) ? result.numpages : pages.length;
  return assessExtractedPdf({ pages, pageCount, byteSize });
}

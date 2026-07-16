/**
 * Minimal ambient types for pdf-parse's inner module. We import
 * `pdf-parse/lib/pdf-parse.js` directly (NOT the package index) to bypass its debug-mode
 * test-file read, which crashes under bundlers. pdf-parse ships no types of its own.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfPageData {
    getTextContent(opts?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<{
      items: Array<{ str: string; transform: number[] }>;
    }>;
  }
  interface PdfParseOptions {
    max?: number;
    pagerender?: (pageData: PdfPageData) => string | Promise<string>;
    version?: string;
  }
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  }
  function pdf(dataBuffer: Buffer | Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdf;
}

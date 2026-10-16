/**
 * Upload validation for the Customs Reference Library. PURE — no I/O.
 * ---------------------------------------------------------------------------
 * CUSTOMS-REF-01A / REF-1. Everything here is decided from the BYTES, never
 * from what the browser said about them.
 *
 * WHY THE BYTES AND NOT THE HEADERS. `File.type` is supplied by the client and
 * `File.name` is user-controlled; both are claims. A request can declare
 * `application/pdf` and carry an HTML page, a zip, or a Windows executable. So
 * the declared type is checked (a cheap early refusal) and then the magic
 * number is checked, and the second is the one that decides.
 *
 * WHAT THIS IS NOT. It is not a malware scanner, and it does not pretend to be
 * one. A well-formed PDF can carry a malicious payload, and nothing in this
 * platform scans for that today. That is exactly why a validated upload lands
 * in QUARANTINE rather than becoming consultable: validation establishes that
 * the file is the KIND of thing claimed, and a human decides whether it is
 * trustworthy. The unresolved gate is recorded, not closed.
 */

/** Bucket-level ceiling in migration 152. Kept in step deliberately. */
export const BUCKET_LIMIT_BYTES = 50 * 1024 * 1024;

/**
 * The ceiling this REF-1 upload path can actually honour.
 *
 * The bucket accepts 50 MB, but the bytes reach it through a Next.js route
 * handler running as a serverless function, and the platform caps a request
 * body at 4.5 MB. Accepting more here would mean accepting uploads that fail
 * in production with a platform error the operator cannot interpret, so the
 * limit is stated at the application boundary where it can be explained.
 *
 * Raising it is not a constant change: it needs a direct-to-storage upload
 * (a server-minted signed upload URL), which is tracked as REF-2 work.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** A PDF shorter than this is not a document; it is a stub or a truncation. */
export const MIN_UPLOAD_BYTES = 1024;

export const ACCEPTED_MIME = "application/pdf";

/** `%PDF-` — the only header this library accepts. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

export type UploadRefusal =
  | "missing_file"
  | "mime_not_pdf"
  | "not_a_pdf"
  | "too_large"
  | "too_small"
  | "size_mismatch"
  | "title_required"
  | "authority_required"
  | "reference_code_required"
  | "category_invalid"
  | "published_on_invalid";

export type UploadValidation =
  | { ok: true }
  | { ok: false; error: UploadRefusal };

/** Does the buffer actually begin with the PDF header? */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i += 1) {
    if (bytes[i] !== PDF_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Validate the bytes and the declared metadata together.
 *
 * `declaredSize` is compared against the real buffer length: a mismatch means
 * the request and its payload disagree, and the only honest response is to
 * refuse rather than to pick one of the two to believe.
 */
export function validateUpload(input: {
  bytes: Uint8Array | null;
  declaredMime: string | null;
  declaredSize: number | null;
  title: string;
  sourceAuthority: string;
  referenceCode: string | null;
  categoryValid: boolean;
  publishedOn: string | null;
}): UploadValidation {
  if (!input.bytes || input.bytes.length === 0) return { ok: false, error: "missing_file" };

  // Declared type first: a cheap, honest refusal before any byte inspection.
  if ((input.declaredMime ?? "").toLowerCase() !== ACCEPTED_MIME) {
    return { ok: false, error: "mime_not_pdf" };
  }
  // …and then the bytes, which are what actually decide.
  if (!hasPdfSignature(input.bytes)) return { ok: false, error: "not_a_pdf" };

  if (input.bytes.length < MIN_UPLOAD_BYTES) return { ok: false, error: "too_small" };
  if (input.bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "too_large" };
  if (
    typeof input.declaredSize === "number"
    && input.declaredSize > 0
    && input.declaredSize !== input.bytes.length
  ) {
    return { ok: false, error: "size_mismatch" };
  }

  if (!input.categoryValid) return { ok: false, error: "category_invalid" };
  if (input.title.trim().length === 0) return { ok: false, error: "title_required" };
  if (input.sourceAuthority.trim().length === 0) {
    return { ok: false, error: "authority_required" };
  }
  // REF-1-HARDEN (F2). The business key is what makes « which edition is in
  // force? » answerable, and what the one-current-edition index is keyed on.
  if ((input.referenceCode ?? "").trim().length === 0) {
    return { ok: false, error: "reference_code_required" };
  }
  if (input.publishedOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.publishedOn)) {
    return { ok: false, error: "published_on_invalid" };
  }

  return { ok: true };
}

/**
 * A storage object name that cannot be influenced by the uploader.
 *
 * The original filename is NOT part of the path. It is user-controlled text
 * and the bucket key is a security-relevant string: a name carrying `..`, a
 * leading slash or a URL-encoded separator is how an upload escapes its
 * prefix. The document's own uuid is already unique and already the thing the
 * row is keyed by, so the filename has no work to do here — it is kept in
 * `title` for humans and nowhere else.
 */
export function buildReferencePath(tenantId: string, documentId: string): string {
  return `${tenantId}/${documentId}.pdf`;
}

/** The filename offered to the browser on download — derived, never echoed. */
export function referenceFileName(title: string, version: number): string {
  const safe = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${safe || "document"}-v${version}.pdf`;
}

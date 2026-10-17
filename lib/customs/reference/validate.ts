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

/**
 * The ceiling the REF-2 direct-to-storage path honours.
 *
 * Identical to the bucket's own limit, and that is the point: the bytes no
 * longer pass through a serverless function, so the only ceiling left is the
 * one migration 152 set on the bucket. Stating it as the same constant means
 * the application cannot promise an upload the bucket will refuse.
 */
export const MAX_DIRECT_UPLOAD_BYTES = BUCKET_LIMIT_BYTES;

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
  | "published_on_invalid"
  // REF-2. The regime axis, refused in the application for a readable message
  // and refused again by `trg_customs_reference_regimes` for real.
  | "regime_too_long"
  | "too_many_regimes";

export type UploadValidation =
  | { ok: true }
  | { ok: false; error: UploadRefusal };

/**
 * The metadata half of an upload, with no bytes in hand.
 *
 * REF-2 needs this on its own: the direct-to-storage path must refuse a bad
 * title or a missing reference code BEFORE it mints an upload URL, because
 * minting one and then refusing the finalise would leave the operator holding
 * a 40 MB upload that was never going to be accepted.
 *
 * `validateUpload` calls this at exactly the point it used to perform these
 * checks inline, so the order of refusals is unchanged and the two paths
 * cannot drift into disagreeing about what valid metadata is.
 */
export function validateReferenceMetadata(input: {
  title: string;
  sourceAuthority: string;
  referenceCode: string | null;
  categoryValid: boolean;
  publishedOn: string | null;
}): UploadValidation {
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
  /**
   * The size ceiling to enforce. Defaults to `MAX_UPLOAD_BYTES`, the limit the
   * REF-1 route-handler path can honour; the REF-2 direct-to-storage path
   * passes `MAX_DIRECT_UPLOAD_BYTES`. A parameter rather than two validators,
   * so there is one place that decides what a valid PDF is.
   */
  maxBytes?: number;
}): UploadValidation {
  const maxBytes = input.maxBytes ?? MAX_UPLOAD_BYTES;
  if (!input.bytes || input.bytes.length === 0) return { ok: false, error: "missing_file" };

  // Declared type first: a cheap, honest refusal before any byte inspection.
  if ((input.declaredMime ?? "").toLowerCase() !== ACCEPTED_MIME) {
    return { ok: false, error: "mime_not_pdf" };
  }
  // …and then the bytes, which are what actually decide.
  if (!hasPdfSignature(input.bytes)) return { ok: false, error: "not_a_pdf" };

  if (input.bytes.length < MIN_UPLOAD_BYTES) return { ok: false, error: "too_small" };
  if (input.bytes.length > maxBytes) return { ok: false, error: "too_large" };
  if (
    typeof input.declaredSize === "number"
    && input.declaredSize > 0
    && input.declaredSize !== input.bytes.length
  ) {
    return { ok: false, error: "size_mismatch" };
  }

  // The metadata half, in the order it was always checked in.
  return validateReferenceMetadata({
    title: input.title,
    sourceAuthority: input.sourceAuthority,
    referenceCode: input.referenceCode,
    categoryValid: input.categoryValid,
    publishedOn: input.publishedOn,
  });
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

/**
 * Where a direct-to-storage upload lands BEFORE it has been looked at.
 *
 * REF-2. The bytes arrive in the bucket without passing through the
 * application, so for a moment the library holds a file nothing has validated.
 * That file must not sit at a path the rest of the system treats as a
 * document's home, so it lands under a `_staging/` prefix and is moved —
 * re-uploaded from the verified buffer — only once the bytes have been read,
 * matched against their declared size and hash, and found to begin with
 * `%PDF-`.
 *
 * `uploadId` is SERVER-GENERATED, exactly like the document id in
 * `buildReferencePath`. The uploader never names a path, so there is no input
 * here that `..`, a leading slash or a URL-encoded separator could escape with.
 *
 * Nothing reads a staging path: the view route resolves bytes through the
 * `storage_path` recorded on a row, and no row exists until the move is done.
 */
export function buildStagingPath(tenantId: string, uploadId: string): string {
  return `${tenantId}/_staging/${uploadId}.pdf`;
}

/** Longest regime name the column accepts, mirroring migration 155. */
export const MAX_REGIME_LENGTH = 48;
/** Most regimes one document may be tagged with, mirroring migration 155. */
export const MAX_REGIMES = 24;

export type RegimeValidation =
  | { ok: true; regimes: string[] }
  | { ok: false; error: "regime_too_long" | "too_many_regimes" };

/**
 * Normalise the regime axis to the shape the column stores.
 *
 * A MIRROR, NOT THE ENFORCEMENT. `trg_customs_reference_regimes` performs the
 * same normalisation inside the database and is what actually guarantees the
 * stored shape — necessarily, because every writer to this table reaches it
 * through the service role or a definer RPC and so bypasses RLS. This function
 * exists so the operator gets a readable refusal before a 40 MB upload rather
 * than a trigger exception after it, and so the row the application builds is
 * already in the form the trigger would produce.
 *
 * Trim, upper-case, drop blanks, de-duplicate, sort. Sorting is what makes two
 * documents carrying the same regimes compare equal as arrays.
 */
export function normalizeRegimes(input: readonly (string | null | undefined)[]): RegimeValidation {
  const seen = new Set<string>();
  for (const raw of input) {
    const v = (raw ?? "").trim().toUpperCase();
    if (v.length === 0) continue;
    if (v.length > MAX_REGIME_LENGTH) return { ok: false, error: "regime_too_long" };
    seen.add(v);
  }
  if (seen.size > MAX_REGIMES) return { ok: false, error: "too_many_regimes" };
  return { ok: true, regimes: [...seen].sort() };
}

/**
 * Split an operator's typed regime list.
 *
 * Commas, semicolons and newlines all separate, because an operator pasting
 * from a circular will use whichever the source used. A regime name itself
 * contains spaces (« MISE EN CONSOMMATION »), so a space is NOT a separator.
 */
export function parseRegimeInput(raw: string | null): string[] {
  return (raw ?? "").split(/[,;\r\n]+/);
}

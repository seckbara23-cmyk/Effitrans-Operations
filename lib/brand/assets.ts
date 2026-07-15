/**
 * Brand asset path + upload validation (DBC-1). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * The SERVER constructs every storage path (never the client) and validates every upload
 * before it reaches the public bucket. Paths are tenant-scoped, immutable and versioned so
 * a public URL is never overwritten in place — a replacement is a NEW object, which keeps
 * already-sent email signatures working and enables rollback.
 *
 * MVP policy (approved): PNG only, ≤ 100 KB. SVG/HTML/scripts/executables are rejected;
 * `file.type` alone is not trusted — the actual PNG byte signature is checked.
 */
import { ASSET_KINDS, type AssetKind } from "./model";

export const MAX_ASSET_BYTES = 100 * 1024; // 100 KB
export const ALLOWED_ASSET_MIME = ["image/png"] as const;

/** Folder per kind — keeps the bucket organized and paths predictable. */
const KIND_FOLDER: Record<AssetKind, string> = {
  LOGO_PRIMARY: "logos",
  LOGO_REVERSED: "logos",
  LOGO_MONOCHROME: "logos",
  LOGO_EMAIL_PNG: "logos",
  NETWORK_LOGO: "networks",
  EMPLOYEE_PHOTO: "people",
};

/** Strip anything unsafe from a filename: no path segments, no traversal, no exotic chars. */
export function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").trim(); // drop any path component
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "-") // allowlist charset
    .replace(/\.{2,}/g, ".") // collapse .. (no traversal)
    .replace(/^[.-]+/, "") // no leading dot/dash
    .slice(0, 80);
  return cleaned || "asset.png";
}

/**
 * Server-built path: `{tenantId}/{folder}/{assetId}/v{version}/{filename}`. Every segment
 * is server-controlled; the tenantId is the session tenant, never client input.
 */
export function buildAssetPath(args: { tenantId: string; kind: AssetKind; assetId: string; version: number; filename: string }): string {
  const folder = KIND_FOLDER[args.kind] ?? "misc";
  const file = sanitizeFilename(args.filename);
  const name = /\.png$/i.test(file) ? file : `${file}.png`;
  return `${args.tenantId}/${folder}/${args.assetId}/v${args.version}/${name}`;
}

/** The PNG magic number (89 50 4E 47 0D 0A 1A 0A). Guards against a disguised non-image. */
export function isPngSignature(bytes: Uint8Array | ArrayBuffer): boolean {
  const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < sig.length) return false;
  return sig.every((v, idx) => b[idx] === v);
}

export type AssetUploadError =
  | "mime_not_allowed" | "extension_not_allowed" | "too_large" | "empty"
  | "not_a_png" | "invalid_kind" | "alt_required" | "bad_dimensions";

/**
 * Validate an upload's metadata + bytes. `signatureOk` is the result of isPngSignature on
 * the real bytes (checked by the caller so this stays pure/sync-testable).
 */
export function validateAssetUpload(input: {
  kind: string;
  mime: string;
  filename: string;
  byteLength: number;
  signatureOk: boolean;
  altText: string;
  width?: number | null;
  height?: number | null;
}): { ok: true } | { ok: false; error: AssetUploadError } {
  if (!(ASSET_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: "invalid_kind" };
  if (!(ALLOWED_ASSET_MIME as readonly string[]).includes(input.mime)) return { ok: false, error: "mime_not_allowed" };
  if (!/\.png$/i.test(input.filename.trim())) return { ok: false, error: "extension_not_allowed" };
  if (input.byteLength <= 0) return { ok: false, error: "empty" };
  if (input.byteLength > MAX_ASSET_BYTES) return { ok: false, error: "too_large" };
  if (!input.signatureOk) return { ok: false, error: "not_a_png" };
  if (!input.altText || input.altText.trim() === "") return { ok: false, error: "alt_required" };
  if ((input.width != null && input.width <= 0) || (input.height != null && input.height <= 0)) {
    return { ok: false, error: "bad_dimensions" };
  }
  return { ok: true };
}

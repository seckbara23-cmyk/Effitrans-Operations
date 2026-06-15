/**
 * HMAC signature helpers for webhook verification (Phase 1.15B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Providers sign the RAW request body; we recompute and timing-safe compare.
 * Kept tiny + dependency-free (node:crypto) so each provider reuses it.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/** Hex HMAC-SHA256 of `body` under `secret`. */
export function hmacSha256Hex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Constant-time compare of two signatures (hex). False on any length/format mismatch. */
export function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Verify a hex HMAC-SHA256 signature header against the raw body. */
export function verifyHmacSignature(secret: string, body: string, signature: string): boolean {
  return safeEqualHex(hmacSha256Hex(secret, body), signature);
}

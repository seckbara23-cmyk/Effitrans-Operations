/**
 * Finance Expense Documents — content hashing (Phase 11.0B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The immutable-version + visa integrity mechanism (DEC-C12/C24): every frozen
 * version snapshot carries a deterministic content_sha256, and each visa records
 * the exact hash it signed. This is the DIGEST support the foundation provides;
 * no signed PDF exists yet (rendering is 11.0C/D), so the hash is computed over
 * the CANONICAL field snapshot — the authoritative business data the PDF will
 * later reproduce.
 *
 * Deterministic by construction: keys are sorted and values normalized, so the
 * same snapshot always yields the same digest (a later phase can re-verify a
 * stored version, and a byte-identical PDF is producible from it).
 */

import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted recursively, so key ORDER never changes the
 * digest. Arrays keep their order (order is data). null/undefined normalize to
 * null. This is the only serialization the digest is ever taken over.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}

/**
 * The content digest of a version snapshot. `docType` and `version` are folded
 * in so an authorization and a voucher (or two versions) with identical business
 * fields still hash distinctly.
 */
export function expenseContentSha256(input: {
  docType: string;
  version: number;
  snapshot: Record<string, unknown>;
}): string {
  const payload = canonicalize({
    docType: input.docType,
    version: input.version,
    snapshot: input.snapshot,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

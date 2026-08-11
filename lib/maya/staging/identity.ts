/**
 * MAYA migration staging — deterministic source identity (MAYA-P0.5-C).
 * PURE. No I/O, no clock, no randomness.
 * ---------------------------------------------------------------------------
 * Duplicate detection is only as trustworthy as the identity it compares, so
 * the hash must be a function of the SOURCE CONTENT alone: the same MAYA
 * record, exported twice, must hash identically — including when the export
 * reorders its columns, changes their case, or pads values with whitespace.
 *
 * It must equally NOT collapse two genuinely different records, so nothing is
 * dropped from the payload: every key/value pair participates.
 *
 * What is deliberately NOT in the hash: the batch, the row number, the import
 * time, the tenant. Those describe the ARRIVAL of the record, not the record —
 * and mixing them in would make the same dossier look new in every batch,
 * which is exactly the silent-duplication failure this exists to prevent.
 */
import { createHash } from "node:crypto";

/** Trim, collapse inner whitespace, and uppercase — the legacy-text normal form. */
export function normalizeKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Canonical serialisation of a MAYA source record: keys normalised and sorted,
 * values normalised, empty values dropped (an absent column and an empty one
 * are the same fact), joined with separators that cannot occur in the
 * normalised text.
 */
export function canonicalizeRecord(raw: Record<string, unknown>): string {
  const pairs: [string, string][] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    const value = normalizeKey(String(v));
    if (value === "") continue;
    pairs.push([normalizeKey(k), value]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}${v}`).join("");
}

/**
 * The deterministic content identity of one MAYA source record.
 * `sourceTable` participates so that the same reference number appearing in
 * two different MAYA files is not mistaken for one record.
 */
export function sourceRowHash(sourceTable: string, raw: Record<string, unknown>): string {
  const canonical = `${normalizeKey(sourceTable)}${canonicalizeRecord(raw)}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Identity of the ARTEFACT a batch was staged from. Lets a re-upload of the
 * same export be recognised before a single row is parsed.
 */
export function artifactHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Customs Intelligence — provider status mapping (Phase 7.1B). PURE.
 * ---------------------------------------------------------------------------
 * The ONE place a provider's raw status vocabulary is translated into the canonical
 * lifecycle. ALLOWLIST ONLY — an unrecognised raw status maps to `unmapped` (never
 * guessed, never fuzzy-matched), and the engine refuses to transition on an unmapped
 * value. This keeps a provider from silently driving the platform into an unexpected
 * state, and makes "we don't understand this yet" an explicit, auditable outcome.
 *
 * GAINDE is NOT wired: the project integrates GAINDE by reference, not by API (BLK-1
 * is still open — no official status vocabulary is available), so GAINDE_STATUS_MAP is
 * intentionally EMPTY. It becomes a real, documented table in 7.1C only once the
 * official GAINDE status list is verified. Adding a real entry without a citation is a
 * guess, and guesses are exactly what this module exists to prevent.
 */
import type { DeclarationStatus } from "./state-machine";
import { isDeclarationStatus } from "./state-machine";

export type MappingConfidence = "exact" | "unmapped";

export type StatusMapResult =
  | { confidence: "exact"; status: DeclarationStatus; reason?: string }
  | { confidence: "unmapped"; status: null; reason: "unknown_provider_status" };

/** One allowlisted raw→canonical rule, with an optional documentation reference. */
export type StatusRule = { status: DeclarationStatus; note?: string };

/**
 * The manual provider has no external vocabulary — its "raw" statuses ARE the canonical
 * ones (a human picks them). We still route them through the allowlist so the same
 * discipline (unknown → unmapped) applies everywhere.
 */
export const MANUAL_STATUS_MAP: Record<string, StatusRule> = Object.freeze({});

/**
 * GAINDE (Sénégal) raw status → canonical. INTENTIONALLY EMPTY until the official
 * GAINDE status vocabulary is verified (7.1C). Do NOT populate from assumptions.
 * When populated, each entry MUST cite the official documentation in `note`.
 */
export const GAINDE_STATUS_MAP: Record<string, StatusRule> = Object.freeze({});

const PROVIDER_MAPS: Record<string, Record<string, StatusRule>> = {
  manual: MANUAL_STATUS_MAP,
  GAINDE: GAINDE_STATUS_MAP,
};

/** Normalise a raw provider status string (trim + upper), never throwing. */
export function normalizeRawStatus(raw: string): string {
  return String(raw ?? "").trim().toUpperCase();
}

/**
 * Map a provider's raw status into the canonical lifecycle. Allowlist only:
 *  - an explicit rule wins;
 *  - for the manual provider, a raw value that is ITSELF a canonical status is accepted
 *    (the human already speaks the canonical vocabulary);
 *  - everything else is `unmapped` — the caller must not transition on it.
 */
export function mapProviderStatus(providerCode: string, raw: string): StatusMapResult {
  const norm = normalizeRawStatus(raw);
  const table = PROVIDER_MAPS[providerCode] ?? {};
  const rule = table[norm];
  if (rule) return { confidence: "exact", status: rule.status, reason: rule.note };
  if (providerCode === "manual" && isDeclarationStatus(norm)) {
    return { confidence: "exact", status: norm as DeclarationStatus };
  }
  return { confidence: "unmapped", status: null, reason: "unknown_provider_status" };
}

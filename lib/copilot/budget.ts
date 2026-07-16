/**
 * Shared Copilot context budgeting (Phase 7.6C — extracted from 7.6B). PURE. No I/O.
 * ---------------------------------------------------------------------------
 * The provider-neutral size discipline every copilot shares: a per-module/section record cap and
 * a hard cap on the total serialized brief. Extracted from lib/logistics/copilot/budget.ts so the
 * Logistics Copilot and the Customer Portal Copilot BUDGET IDENTICALLY instead of each carrying
 * its own numbers. The DOMAIN part of budgeting (which question classes exist, which
 * modules/sections a class prioritizes) stays with each copilot — only the neutral primitives live
 * here. Truncation is always disclosed by the caller, never silent.
 */

/** Caps shared by every copilot. */
export const BUDGET = {
  /** Full per-section record cap for prioritized sections. */
  priorityCap: 25,
  /** Reduced cap for non-prioritized sections — trimmed, never zeroed. */
  minorCap: 8,
  /** Total serialized brief hard cap (chars) — well under the AI layer's 24k prompt cap. */
  maxSerializedChars: 12_000,
} as const;

/** Cap the total serialized brief; report whether it was truncated. */
export function capSerialized(text: string): { text: string; truncated: boolean } {
  if (text.length <= BUDGET.maxSerializedChars) return { text, truncated: false };
  return { text: text.slice(0, BUDGET.maxSerializedChars) + "\n… [contexte tronqué]", truncated: true };
}

/**
 * Per-key record caps: the full cap for prioritized keys, a reduced (non-zero) cap for the rest —
 * so a requested section is never silently emptied. Generic over the copilot's own key union.
 */
export function capsFor<K extends string>(all: readonly K[], prioritized: readonly K[]): Record<K, number> {
  const priority = new Set<K>(prioritized);
  const caps = {} as Record<K, number>;
  for (const k of all) caps[k] = priority.has(k) ? BUDGET.priorityCap : BUDGET.minorCap;
  return caps;
}

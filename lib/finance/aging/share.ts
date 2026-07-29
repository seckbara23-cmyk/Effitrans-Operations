/**
 * Portfolio shares in BASIS POINTS, apportioned so they sum to exactly 100 %.
 * PURE. No imports.
 * ---------------------------------------------------------------------------
 * « Part encours » is the one genuinely fractional quantity in the report, and
 * the naive implementation — round(amount / total) per row — does not add up.
 * Seventy clients each rounded independently land somewhere near 99.97 % or
 * 100.02 %, and a total row that prints "100 %" while its column does not sum to
 * 100 % is the kind of detail that costs a finance team its trust in a report.
 *
 * The reference workbook's shares sum to exactly 1.0, so exactness is the
 * observed behaviour, not a nicety.
 *
 * LARGEST REMAINDER (Hare quota): give every entry its floored share, then hand
 * the leftover basis points to the entries with the largest discarded remainder,
 * one each. The result is exact by construction — Σ = 10000 always — and stable:
 * ties break on the caller's order, which is already deterministic (amount
 * descending, then a stable key), so the same input always produces the same
 * apportionment.
 *
 * Integers only: remainders are compared as cross-multiplied integers, never as
 * floating-point ratios.
 */

export const BASIS_POINTS_TOTAL = 10_000;

/**
 * Apportion `BASIS_POINTS_TOTAL` across `amounts` in proportion to their size.
 *
 * Returns one basis-point figure per input, in the same order, summing to
 * exactly 10000 — or all zeros when the total is zero (an empty report has no
 * shares to state, and 0/0 is not 100 %).
 */
export function apportionBasisPoints(amounts: readonly number[]): number[] {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (total <= 0 || amounts.length === 0) return amounts.map(() => 0);

  // Floor(amount * 10000 / total), plus the exact integer remainder.
  const floored: number[] = [];
  const remainders: { index: number; remainder: number }[] = [];
  let assigned = 0;

  for (let i = 0; i < amounts.length; i++) {
    const scaled = amounts[i] * BASIS_POINTS_TOTAL;
    const q = Math.floor(scaled / total);
    floored.push(q);
    assigned += q;
    remainders.push({ index: i, remainder: scaled - q * total });
  }

  let leftover = BASIS_POINTS_TOTAL - assigned;
  if (leftover > 0) {
    // Largest remainder first; ties keep the caller's (already deterministic) order.
    remainders.sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));
    for (let k = 0; k < leftover; k++) {
      floored[remainders[k % remainders.length].index] += 1;
    }
    leftover = 0;
  }

  return floored;
}

/** Basis points → the fraction a renderer formats (0.2394 for 23,94 %). */
export function basisPointsToFraction(bp: number): number {
  return bp / BASIS_POINTS_TOTAL;
}

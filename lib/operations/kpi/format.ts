/**
 * Executive KPI Engine — display formatting (Phase 10.0D-4). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * Presentation-only projections over the authoritative contract — NO business
 * calculation, NO currency combination, NO comparison recomputation. The UI
 * renders exactly what the engine produced; these helpers only shape it for a
 * French/XOF locale. Unit-tested directly.
 */
import type { KpiComparison } from "./types";

/** « 12 500 000 XOF » — fr-FR grouping + explicit currency code (never abbreviated ambiguously). */
export function formatMoneyAmount(amount: number, currency: string): string {
  return `${Math.round(amount).toLocaleString("fr-FR")} ${currency}`;
}

/** fr-FR percent with a comma decimal, at most one fraction digit — « 8,4 % ». */
export function formatPercent(pct: number): string {
  return `${pct.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %`;
}

export type ComparisonDisplay = {
  /** Directional glyph — "" when direction is unknown (no misleading arrow). */
  symbol: "" | "↑" | "↓" | "→";
  /** Visible text, e.g. « ↑ 8,4 % vs juin (mois complet) » or « Comparaison indisponible ». */
  text: string;
  /** Screen-reader text — direction spelled out, never colour/symbol-only. */
  srText: string;
  /** Whether a directional value exists (drives neutral styling — NOT green/red). */
  known: boolean;
};

/**
 * Project a per-currency comparison for display. DEC-B41: `unknown` /
 * `changePercent === null` renders « Comparaison indisponible » with NO arrow —
 * never a fabricated 0 % or 100 %. Direction is conveyed by symbol AND words
 * (accessibility), and the engine's explicit label (« vs juin (mois complet) »)
 * is preserved verbatim — never rewritten as an equal-period claim. Styling
 * stays NEUTRAL: this phase assigns no favourable/unfavourable colour (the
 * contract carries no favourable-direction flag).
 */
export function comparisonDisplay(comparison: KpiComparison | undefined): ComparisonDisplay | null {
  if (!comparison) return null;
  if (comparison.direction === "unknown" || comparison.changePercent == null) {
    return {
      symbol: "",
      text: "Comparaison indisponible",
      srText: `Comparaison indisponible ${comparison.label}`,
      known: false,
    };
  }
  if (comparison.direction === "flat") {
    return { symbol: "→", text: `→ stable ${comparison.label}`, srText: `stable ${comparison.label}`, known: true };
  }
  const symbol = comparison.direction === "up" ? "↑" : "↓";
  const verb = comparison.direction === "up" ? "en hausse de" : "en baisse de";
  const pct = formatPercent(Math.abs(comparison.changePercent));
  return {
    symbol,
    text: `${symbol} ${pct} ${comparison.label}`,
    srText: `${verb} ${pct} ${comparison.label}`,
    known: true,
  };
}

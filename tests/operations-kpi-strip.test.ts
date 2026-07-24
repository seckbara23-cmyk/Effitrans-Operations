/**
 * Phase 10.0D-4 — Executive KPI strip. The pure formatters (currency, percent,
 * comparison display) are exercised DIRECTLY; the strip / card / cockpit wiring is
 * verified STRUCTURALLY (consumes getOperationsKpis, no business formula or table read
 * in UI, one-strip rule, per-currency money, honest states, verified drill-downs,
 * « Revenu du mois » retired).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { formatMoneyAmount, formatPercent, comparisonDisplay } from "@/lib/operations/kpi/format";
import type { KpiComparison } from "@/lib/operations/kpi/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const STRIP = code("../components/operations/executive-kpi-strip.tsx");
const CARD = code("../components/operations/executive-kpi-card.tsx");
const FORMAT = code("../lib/operations/kpi/format.ts");
const SECTIONS = code("../components/operations/cockpit-sections.tsx");
const SUPPORTING = code("../components/operations/dashboard-supporting.tsx");
const CONTROL_TOWER = code("../components/dashboard/control-tower.tsx");
const FINANCE_CARD = code("../components/operations/finance-pipeline-card.tsx");
const UI_FILES = [STRIP, CARD];

const cmp = (over: Partial<KpiComparison> = {}): KpiComparison => ({
  label: "vs juin (mois complet)", value: 100, direction: "up", changePercent: 8.4, ...over,
});

// fr-FR toLocaleString uses a narrow/non-breaking space for grouping (the platform
// convention, matching lib/executive/compose); normalize to ASCII for stable assertions.
const ns = (s: string) => s.replace(/[  ]/g, " ");

// ================================================================ pure: money + percent ====
describe("money formatting — fr-FR grouping, explicit currency, no ambiguous abbreviation", () => {
  it("groups thousands the French way and keeps the currency code", () => {
    expect(ns(formatMoneyAmount(12_500_000, "XOF"))).toBe("12 500 000 XOF");
    expect(ns(formatMoneyAmount(18_400, "EUR"))).toBe("18 400 EUR");
    expect(ns(formatMoneyAmount(0, "XOF"))).toBe("0 XOF");
  });
  it("percent uses a comma decimal, at most one fraction digit", () => {
    expect(ns(formatPercent(8.4))).toBe("8,4 %");
    expect(ns(formatPercent(20))).toBe("20 %");
  });
});

// ================================================================ pure: comparison display (DEC-B41) ====
describe("comparison display — honest, accessible, never a fabricated arrow", () => {
  it("up/down/flat get a glyph AND spelled-out screen-reader text (not colour-only)", () => {
    const up = comparisonDisplay(cmp({ direction: "up", changePercent: 8.4 }))!;
    expect(up.symbol).toBe("↑");
    expect(ns(up.text)).toBe("↑ 8,4 % vs juin (mois complet)");
    expect(ns(up.srText)).toBe("en hausse de 8,4 % vs juin (mois complet)");
    const down = comparisonDisplay(cmp({ direction: "down", changePercent: -12 }))!;
    expect(down.symbol).toBe("↓");
    expect(ns(down.srText)).toBe("en baisse de 12 % vs juin (mois complet)");
    const flat = comparisonDisplay(cmp({ direction: "flat", changePercent: 0 }))!;
    expect(flat.symbol).toBe("→");
    expect(flat.text).toContain("stable");
  });
  it("unknown / null percent → « Comparaison indisponible », NO arrow (DEC-B41)", () => {
    const unknown = comparisonDisplay(cmp({ direction: "unknown", changePercent: null }))!;
    expect(unknown.symbol).toBe("");
    expect(unknown.text).toBe("Comparaison indisponible");
    expect(unknown.known).toBe(false);
    // Even a non-null percent is suppressed if the engine says unknown.
    expect(comparisonDisplay(cmp({ direction: "unknown", changePercent: 5 }))!.symbol).toBe("");
  });
  it("preserves the engine's explicit label verbatim — never rewritten as equal-period", () => {
    const d = comparisonDisplay(cmp())!;
    expect(d.text).toContain("vs juin (mois complet)");
    expect(FORMAT).not.toContain("période équivalente");
    expect(FORMAT).not.toContain("même période");
  });
  it("returns null when the engine supplied no comparison", () => {
    expect(comparisonDisplay(undefined)).toBeNull();
  });
});

// ================================================================ structural: engine consumption ====
describe("the strip consumes the authoritative engine — no business logic in UI", () => {
  it("/dashboard fetches getOperationsKpis via CockpitSections", () => {
    expect(SECTIONS).toContain("getOperationsKpis");
    expect(SECTIONS).toContain("ExecutiveKpiStrip");
  });
  it("presentational components read NO tables and import NO business readers", () => {
    for (const src of UI_FILES) {
      expect(src).not.toContain("getAdminSupabaseClient");
      expect(src).not.toMatch(/\.from\(/);
      expect(src).not.toContain("getExecutiveAnalytics");
      expect(src).not.toMatch(/@\/lib\/(finance|customs|transport|analytics|control-tower)\//);
    }
  });
  it("the strip computes no totals / no currency merge / no comparison recompute", () => {
    for (const src of UI_FILES) {
      expect(src).not.toMatch(/\.reduce\(/); // no summing in UI
      expect(src).not.toContain("changePercent =");
    }
    // Money + comparison come from the pure formatters, applied as-is.
    expect(CARD).toContain("formatMoneyAmount(a.amount, a.currency)");
    expect(CARD).toContain("comparisonDisplay(");
  });
});

// ================================================================ structural: one-strip rule ====
describe("one executive KPI band on /dashboard (Control Tower overlap resolved)", () => {
  it("the Control Tower KPI band is suppressed on the cockpit", () => {
    expect(SUPPORTING).toContain("showExecutiveKpis={false}");
    expect(CONTROL_TOWER).toContain("showExecutiveKpis = true"); // default preserves every other consumer
    expect(CONTROL_TOWER).toContain("{showExecutiveKpis && (");
  });
  it("Control Tower's other sections are NOT gated by the flag (risk / SLA / funnel remain)", () => {
    for (const kept of ["t.risk.attention.title", "t.sla.monitoring", "C.funnel.title", "C.flow.title", "t.sla.delayed.title"]) {
      expect(CONTROL_TOWER).toContain(kept);
    }
  });
  it("the strip replaces the summary only for analytics-authorized viewers (kpiSet non-null)", () => {
    expect(SECTIONS).toContain("kpiSet ? <ExecutiveKpiStrip kpis={kpiSet} /> : <CockpitSummaryCards");
  });
});

// ================================================================ structural: monetary presentation ====
describe("monetary presentation — always per currency, never merged", () => {
  it("the card iterates the per-currency amounts array and never sums across currencies", () => {
    expect(CARD).toContain("amounts.map((a)");
    expect(CARD).toContain("key={a.currency}");
    expect(CARD).not.toMatch(/\+.*amount|amount.*\+/); // no addition of amounts
  });
  it("comparison is looked up per currency for amount KPIs", () => {
    expect(CARD).toContain('kpi.amounts?.find((a) => a.currency === currency)?.comparison');
  });
  it("no exchange-rate / conversion anywhere in the KPI UI or formatters", () => {
    for (const src of [STRIP, CARD, FORMAT]) {
      expect(src.toLowerCase()).not.toContain("exchange");
      expect(src.toLowerCase()).not.toMatch(/convert.*currency|currency.*convert/);
    }
  });
});

// ================================================================ structural: state honesty ====
describe("status honesty — zero vs unavailable vs partial are distinct", () => {
  it("unavailable renders « Indisponible », NEVER a zero", () => {
    expect(CARD).toContain('kpi.status === "unavailable"');
    expect(CARD).toContain("Indisponible");
  });
  it("a real count of 0 renders as 0 (value ?? 0 only after the unavailable guard)", () => {
    expect(CARD).toContain("{kpi.value ?? 0}");
    // The unavailable case returns BEFORE that line, so ?? 0 never masks a null KPI.
    expect(CARD).toMatch(/status === "unavailable"[\s\S]*return[\s\S]*kpi\.value \?\? 0/);
  });
  it("an empty money array (successful source) renders a truthful zero-state, not « Indisponible »", () => {
    expect(CARD).toContain("amounts.length === 0");
    expect(CARD).toContain("Aucun montant sur la période");
  });
  it("partial surfaces a subtle warning + safe basis count, never IDs or error detail", () => {
    expect(CARD).toContain('kpi.status !== "partial"');
    expect(CARD).toContain("Données partielles");
    expect(CARD).toContain("élément(s) exclu(s)");
    expect(CARD).not.toContain("basis.note"); // no raw note/id echoed to the user
  });
});

// ================================================================ structural: drill-downs ====
describe("drill-downs — only audited routes; needs-attention has no fabricated href", () => {
  it("every strip KPI href in the engine is an existing route (D-0 drill-down audit)", () => {
    const READER = code("../lib/operations/kpi/reader.ts");
    for (const href of [
      '"/files"', '"/customs/intelligence"', '"/finance?status=ISSUED"',
      '"/finance/reconciliation"', '"/collections"', '"/finance"', '"/transport?status=DELIVERED"',
    ]) {
      expect(READER).toContain(href);
    }
  });
  it("dossiers_intervention (CEO attention KPI) carries NO href", () => {
    const READER = code("../lib/operations/kpi/reader.ts");
    expect(READER).toMatch(/key: "dossiers_intervention"[\s\S]{0,320}source: "control-tower-risk",\s*\n\s*\}\)/);
  });
  it("the card links only when the engine supplied an href", () => {
    expect(CARD).toContain("kpi.href ?");
  });
});

// ================================================================ structural: label retirement + a11y ====
describe("« Revenu du mois » retired; authoritative money labels present; a11y", () => {
  it("no cockpit surface still shows « Revenu du mois »", () => {
    for (const src of [STRIP, CARD, FINANCE_CARD, SECTIONS, SUPPORTING]) {
      expect(src).not.toContain("Revenu du mois");
    }
    // The finance card no longer renders finance.revenueThisMonth as a value.
    expect(FINANCE_CARD).not.toMatch(/label="Revenu du mois"/);
  });
  it("the authoritative French labels come from the engine (strip does not hard-code KPI labels)", () => {
    // The strip renders kpi.label — it must not redefine the French wording itself.
    expect(STRIP).toContain("kpi");
    expect(STRIP).not.toContain("Facturé (mois)"); // labels live in the engine, not the UI
    expect(CARD).toContain("{kpi.label}");
  });
  it("semantic heading, per-currency keys, and SR text for comparisons", () => {
    expect(STRIP).toContain('aria-labelledby="executive-kpis-heading"');
    expect(STRIP).toContain("Indicateurs exécutifs");
    expect(CARD).toContain("sr-only");
    expect(CARD).toContain("c.srText");
  });
  it("no raw stable keys / source names / UUIDs are displayed", () => {
    // The card renders label/value/amounts/comparison — never kpi.key or kpi.source.
    expect(CARD).not.toMatch(/>\s*\{kpi\.key\}/);
    expect(CARD).not.toContain("kpi.source");
  });
  it("responsive: single column on mobile, multi-column grid on larger screens", () => {
    expect(STRIP).toContain("grid-cols-1");
    expect(STRIP).toMatch(/sm:grid-cols-2|lg:grid-cols-3/);
  });
});

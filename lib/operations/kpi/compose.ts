/**
 * Executive KPI Engine — pure composition (Phase 10.0D-1). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * The currency core (DEC-B40), comparison logic (DEC-B41) and KPI builders.
 * Contains NO business formula: values arrive from the authoritative readers;
 * this file only groups, compares, and shapes them into the typed contract.
 */
import { isOverdue } from "@/lib/finance/calc";
import type { InvoiceStatus } from "@/lib/finance/types";
import type { KpiComparison, KpiMoney, KpiWindow, OperationsKpi } from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- currency core (DEC-B40) ----

/**
 * Group monetary rows per currency — THE only legal aggregation of money.
 * Rows with a missing/blank currency or non-finite amount are DROPPED and
 * reported via the second return value so callers can surface a data-quality
 * basis (DEC-B46) instead of silently mixing garbage into a total.
 */
export function groupAmountsByCurrency(
  rows: { currency: string | null | undefined; amount: number | null | undefined }[],
): { amounts: KpiMoney[]; excluded: number } {
  const byCurrency = new Map<string, number>();
  let excluded = 0;
  for (const r of rows) {
    const currency = (r.currency ?? "").trim();
    if (!currency || typeof r.amount !== "number" || !Number.isFinite(r.amount)) {
      excluded += 1;
      continue;
    }
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + r.amount);
  }
  const amounts = [...byCurrency.entries()]
    .map(([currency, amount]): KpiMoney => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { amounts, excluded };
}

// ---------------------------------------------------------------- comparison (DEC-B41) ----

/**
 * Flow-metric comparison against a prior period. DEC-B41: a prior of 0 or null
 * yields direction "unknown" and changePercent null — never ∞, never a
 * fabricated 100 %. The label MUST name the comparison basis honestly
 * (e.g. « vs juin (mois complet) »).
 */
export function flowComparison(current: number | null, previous: number | null, label: string): KpiComparison {
  if (current == null || previous == null || previous === 0) {
    return { label, value: previous, direction: "unknown", changePercent: null };
  }
  const direction = current > previous ? "up" : current < previous ? "down" : "flat";
  return {
    label,
    value: previous,
    direction,
    changePercent: round1(((current - previous) / previous) * 100),
  };
}

// ---------------------------------------------------------------- builders ----

/**
 * Count-kind KPI. `value: null` ⇒ status "unavailable" (source dark or failed);
 * a data-quality basis with exclusions ⇒ "partial" (DEC-B46).
 */
export function countKpi(input: {
  key: string;
  label: string;
  value: number | null;
  window: KpiWindow;
  source: string;
  href?: string;
  comparison?: KpiComparison;
  basis?: { included: number; excluded: number; note?: string };
}): OperationsKpi {
  const status = input.value == null ? "unavailable" : (input.basis?.excluded ?? 0) > 0 ? "partial" : "ready";
  return {
    key: input.key,
    label: input.label,
    kind: "count",
    value: input.value,
    window: input.window,
    ...(input.comparison ? { comparison: input.comparison } : {}),
    source: input.source,
    freshness: "live-request",
    status,
    ...(input.basis ? { basis: input.basis } : {}),
    ...(input.href ? { href: input.href } : {}),
  };
}

/**
 * Amount-kind KPI (10.0D-3): per-currency values only; `value` stays null by
 * contract — a cross-currency scalar cannot be expressed (DEC-B40). An empty
 * amounts list with a live source is a REAL zero-money state and renders ready;
 * a null amounts input means the source was unavailable.
 */
export function amountKpi(input: {
  key: string;
  label: string;
  amounts: KpiMoney[] | null;
  window: KpiWindow;
  source: string;
  href?: string;
  comparison?: KpiComparison;
  basis?: { included: number; excluded: number; note?: string };
}): OperationsKpi {
  const status = input.amounts == null ? "unavailable" : (input.basis?.excluded ?? 0) > 0 ? "partial" : "ready";
  return {
    key: input.key,
    label: input.label,
    kind: "amount",
    value: null,
    amounts: input.amounts ?? [],
    window: input.window,
    ...(input.comparison ? { comparison: input.comparison } : {}),
    source: input.source,
    freshness: "live-request",
    status,
    ...(input.basis ? { basis: input.basis } : {}),
    ...(input.href ? { href: input.href } : {}),
  };
}

// ---------------------------------------------------------------- money KPI builders (DEC-B44) ----

type MoneyRow = { currency: string | null | undefined; amount: number | null | undefined };

/**
 * A per-currency FLOW money KPI with prior-full-month comparison (Facturé /
 * Encaissé). Each currency's amount carries its OWN comparison (DEC-B40/B41 —
 * never compressed across currencies; prior 0/null ⇒ unknown). A currency
 * present only in the prior period is not fabricated into the current list.
 * `current == null` ⇒ unavailable; excluded rows ⇒ partial with basis (DEC-B46).
 */
export function moneyFlowKpi(input: {
  key: string;
  label: string;
  current: MoneyRow[] | null;
  previous: MoneyRow[];
  window: KpiWindow;
  source: string;
  href?: string;
  comparisonLabel: string;
}): OperationsKpi {
  if (input.current == null) {
    return amountKpi({ key: input.key, label: input.label, amounts: null, window: input.window, source: input.source, href: input.href });
  }
  const cur = groupAmountsByCurrency(input.current);
  const prevMap = new Map(groupAmountsByCurrency(input.previous).amounts.map((a) => [a.currency, a.amount]));
  const amounts: KpiMoney[] = cur.amounts.map((a) => ({
    currency: a.currency,
    amount: a.amount,
    comparison: flowComparison(a.amount, prevMap.get(a.currency) ?? null, input.comparisonLabel),
  }));
  const basis = { included: input.current.length - cur.excluded, excluded: cur.excluded };
  return amountKpi({ key: input.key, label: input.label, amounts, window: input.window, source: input.source, href: input.href, basis });
}

/**
 * A per-currency SNAPSHOT money KPI (Créances en retard) — NO comparison
 * (DEC-B42: no snapshot history). `basis.included` is the count of contributing
 * (overdue, valid-currency) invoices — the mission's overdue-invoice count.
 */
export function moneySnapshotKpi(input: {
  key: string;
  label: string;
  rows: MoneyRow[] | null;
  window: KpiWindow;
  source: string;
  href?: string;
  note?: string;
}): OperationsKpi {
  if (input.rows == null) {
    return amountKpi({ key: input.key, label: input.label, amounts: null, window: input.window, source: input.source, href: input.href });
  }
  const g = groupAmountsByCurrency(input.rows);
  const basis = { included: input.rows.length - g.excluded, excluded: g.excluded, ...(input.note ? { note: input.note } : {}) };
  return amountKpi({ key: input.key, label: input.label, amounts: g.amounts, window: input.window, source: input.source, href: input.href, basis });
}

/**
 * Overdue receivable balances at the TENANT-DAY boundary, grouped-ready. REUSES
 * the authoritative `isOverdue` predicate (lib/finance/calc) — never a second
 * overdue rule. The boundary is the tenant's current calendar date rendered as
 * UTC midnight, so `isOverdue`'s internal UTC-midnight floor is a no-op and the
 * comparison is a pure tenant-calendar-date one (DEC-B39). Balances come
 * straight from getFinanceQueue (authoritative balanceDue) — no arithmetic here.
 */
export function overdueRowsAtTenantDay(
  items: { status: InvoiceStatus; dueDate: string | null; balance: number; currency: string }[],
  tenantTodayIso: string,
): { currency: string; amount: number }[] {
  const boundary = new Date(`${tenantTodayIso}T00:00:00Z`);
  return items
    .filter((i) => isOverdue(i.status, i.dueDate, i.balance, boundary))
    .map((i) => ({ currency: i.currency, amount: i.balance }));
}

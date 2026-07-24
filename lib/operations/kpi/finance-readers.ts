/**
 * Executive KPI Engine — Finance windowed readers (Phase 10.0D-3). SERVER-ONLY,
 * read-only.
 * ---------------------------------------------------------------------------
 * Facturé (invoice issue_date) and Encaissé (payment paid_at) over the tenant
 * month-to-date window AND the full previous tenant month (one span fetch,
 * split in memory). BOTH date fields are DATE-grain (§7), compared as tenant
 * CALENDAR dates — never routed through a UTC instant.
 *
 * REUSE, never reimplement (Scope F):
 *  - invoice totals come from the authoritative `invoiceTotals` (lib/finance/calc)
 *    — this module performs NO line arithmetic;
 *  - the "issued set" is the platform's ratified {ISSUED, PARTIALLY_PAID, PAID}
 *    (applied inline platform-wide — there is no single exported constant);
 *  - the reversal rule is `reversed_at IS NULL` — the SAME rule `paidAmount`
 *    encodes, applied as a filter, not a second rule;
 *  - a payment's currency comes from its linked invoice (payment has no currency
 *    column); an unresolved currency is returned as null so the caller EXCLUDES
 *    and counts it — never defaulted to XOF or the org currency (Scope B).
 *
 * Each reader returns null on query failure (→ the KPI renders unavailable,
 * never a confident zero). Rows carry the currency verbatim (possibly null) so
 * the pure grouping layer owns the per-currency segregation + exclusion basis.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { invoiceTotals } from "@/lib/finance/calc";

/** The ratified issued set — invoices that count toward realized billing. */
const ISSUED_STATUSES = ["ISSUED", "PARTIALLY_PAID", "PAID"] as const;

export type MoneyContribution = { currency: string | null; amount: number };
export type WindowedMoney = { current: MoneyContribution[]; previous: MoneyContribution[] };

/** Split rows into MTD (dateIso ≥ mtdStart) vs previous month (below it). */
function partition<T>(rows: T[], dateOf: (r: T) => string | null, mtdStart: string): { current: T[]; previous: T[] } {
  const current: T[] = [];
  const previous: T[] = [];
  for (const r of rows) {
    const d = dateOf(r);
    if (!d) continue; // no event date ⇒ not in either window
    (d >= mtdStart ? current : previous).push(r);
  }
  return { current, previous };
}

/**
 * Facturé — Σ authoritative invoice totals (issued set) by currency, split into
 * MTD and the previous full month. Span = [prevMonthStart, mtdEnd) on issue_date.
 */
export async function readInvoicedByWindow(
  tenantId: string,
  bounds: { mtdStart: string; mtdEnd: string; prevStart: string },
): Promise<WindowedMoney | null> {
  const admin = getAdminSupabaseClient();
  try {
    const { data: invoices, error } = await admin
      .from("invoice")
      .select("id, currency, issue_date")
      .eq("tenant_id", tenantId)
      .in("status", [...ISSUED_STATUSES])
      .gte("issue_date", bounds.prevStart)
      .lt("issue_date", bounds.mtdEnd)
      .returns<{ id: string; currency: string | null; issue_date: string | null }[]>();
    if (error) return null;
    const rows = invoices ?? [];
    if (rows.length === 0) return { current: [], previous: [] };

    const { data: lines, error: lineError } = await admin
      .from("invoice_line")
      .select("invoice_id, quantity, unit_amount, tax_rate")
      .eq("tenant_id", tenantId)
      .in("invoice_id", rows.map((r) => r.id))
      .returns<{ invoice_id: string; quantity: number; unit_amount: number; tax_rate: number }[]>();
    if (lineError) return null;

    const linesByInvoice = new Map<string, { quantity: number; unitAmount: number; taxRate: number }[]>();
    for (const l of lines ?? []) {
      const list = linesByInvoice.get(l.invoice_id) ?? [];
      list.push({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) });
      linesByInvoice.set(l.invoice_id, list);
    }

    const contributions = rows.map((r) => ({
      currency: r.currency,
      amount: invoiceTotals(linesByInvoice.get(r.id) ?? []).total, // authoritative total — no local math
      issueDate: r.issue_date,
    }));
    const { current, previous } = partition(contributions, (c) => c.issueDate, bounds.mtdStart);
    return {
      current: current.map((c) => ({ currency: c.currency, amount: c.amount })),
      previous: previous.map((c) => ({ currency: c.currency, amount: c.amount })),
    };
  } catch {
    return null;
  }
}

/**
 * Encaissé — Σ non-reversed payment amounts by LINKED-INVOICE currency, split
 * into MTD and the previous full month. Span = [prevMonthStart, mtdEnd) on
 * paid_at (DATE-grain). A payment whose invoice currency does not resolve keeps
 * a null currency ⇒ the grouping layer excludes and counts it.
 */
export async function readCollectedByWindow(
  tenantId: string,
  bounds: { mtdStart: string; mtdEnd: string; prevStart: string },
): Promise<WindowedMoney | null> {
  const admin = getAdminSupabaseClient();
  try {
    const { data, error } = await admin
      .from("payment")
      .select("amount, paid_at, invoice:invoice_id(currency)")
      .eq("tenant_id", tenantId)
      .is("reversed_at", null) // the reversal rule (same as paidAmount) — applied, not redefined
      .gte("paid_at", bounds.prevStart)
      .lt("paid_at", bounds.mtdEnd)
      .returns<{ amount: number; paid_at: string | null; invoice: { currency: string | null } | null }[]>();
    if (error) return null;
    const rows = data ?? [];

    const contributions = rows.map((r) => ({
      currency: r.invoice?.currency ?? null, // never defaulted — null ⇒ excluded downstream
      amount: Number(r.amount),
      paidAt: r.paid_at,
    }));
    const { current, previous } = partition(contributions, (c) => c.paidAt, bounds.mtdStart);
    return {
      current: current.map((c) => ({ currency: c.currency, amount: c.amount })),
      previous: previous.map((c) => ({ currency: c.currency, amount: c.amount })),
    };
  } catch {
    return null;
  }
}

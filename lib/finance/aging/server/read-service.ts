import "server-only";

/**
 * Aging Balance read service — canonical Finance records → the pure engine.
 * SERVER-ONLY. READ-ONLY.
 * ---------------------------------------------------------------------------
 * This file is the ONLY seam between the database and the aging engine:
 *
 *     canonical Finance query   (here)
 *              ↓
 *     as-of AR input assembly   (here)
 *              ↓
 *     FIN-AGING-1 pure engine   (lib/finance/aging — no Supabase, no clock)
 *              ↓
 *     one five-tab view model   (consumed by the UI, which formats only)
 *
 * ===========================================================================
 * IT WRITES NOTHING
 * ===========================================================================
 * Opening the workspace must not create an `aging_report` row, must not touch an
 * invoice, and must not record a snapshot. A report is a deliberate act performed
 * by someone with `finance:aging:draft_create`, arriving in a later phase; a page
 * view is not that act. Every statement below is a SELECT, and a test asserts it.
 *
 * Consequently what the workspace shows is a LIVE PROJECTION: re-open it tomorrow
 * with the same arrêté and a payment entered in between, and the figures move.
 * That is correct for a draft view and is exactly why finalized snapshots exist —
 * the UI says so rather than letting the distinction be discovered later.
 *
 * ===========================================================================
 * THE BALANCE IS DERIVED, NEVER READ
 * ===========================================================================
 * No stored "outstanding" column is trusted. The service assembles the invoice's
 * lines and its movements and hands them to the engine, which applies the
 * ratified as-of rules (Q-01 / Q-03). Payments are the only movement kind that
 * exists today; credit notes and adjustments have no tables yet, so the
 * allocation list simply has none — the engine's formula is unchanged and will
 * pick them up untouched when FIN-AGING adds them.
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  buildAgingReport,
  isoDate,
  money,
  parseAmount,
  type AgingReportViewModel,
  type Allocation,
  type AverageDelayPopulation,
  type InvoiceInput,
  type InvoiceStatus,
  type IsoDate,
  type Money,
} from "@/lib/finance/aging";

/** The engine version pinned into any snapshot built from this data. */
export const AGING_ENGINE_VERSION = "fin-aging-1";

export type AgingQuery = {
  tenantId: string;
  reportingDate: IsoDate;
  currency: string;
  averageDelayPopulation?: AverageDelayPopulation;
};

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  client_id: string | null;
  file_id: string | null;
  legacy_file_reference: string | null;
  provenance: string | null;
  currency: string | null;
  issue_date: string | null;
  due_date: string | null;
  status: string;
  voided_at: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
};

type LineRow = { invoice_id: string; quantity: number; unit_amount: number; tax_rate: number };
type PaymentRow = { invoice_id: string; amount: number; paid_at: string; reversed_at: string | null };
type ClientRow = { id: string; name: string };
type FileRow = { id: string; file_number: string | null };
type FollowUpRow = { invoice_id: string; note: string | null; created_at: string };

/** numeric(14,2) arrives as a number or a string depending on the driver path. */
function toMoney(value: number | string): Money {
  if (typeof value === "string") return parseAmount(value);
  // A float from PostgREST is still exact at 2 dp for numeric(14,2); round at the
  // boundary and refuse anything that is not a whole number of minor units.
  return money(Math.round(value * 100));
}

function lineTotalMinorUnits(l: LineRow): number {
  const gross = Number(l.quantity) * Number(l.unit_amount);
  const withTax = gross * (1 + Number(l.tax_rate ?? 0) / 100);
  return Math.round(withTax * 100);
}

/**
 * Build the five-tab view model for one tenant, as of one date, in one currency.
 *
 * Request-memoized: the page renders five tabs from a single computation, so the
 * dashboard, the rows, the client ranking, the critical list and the charts are
 * literally the same object — they cannot disagree.
 */
export const getAgingReportView = cache(
  async (query: AgingQuery): Promise<AgingReportViewModel> => {
    const supabase = getAdminSupabaseClient();
    const { tenantId, reportingDate } = query;

    // Only receivables that could be open at the arrêté. DRAFT is excluded here
    // AND by the engine's population rule; VOID rows are kept because an invoice
    // voided AFTER the arrêté was still live on that date (the engine decides,
    // using voided_at, not the current status).
    const { data: invoiceRows, error } = await supabase
      .from("invoice")
      .select(
        "id, invoice_number, client_id, file_id, legacy_file_reference, provenance, currency, " +
          "issue_date, due_date, status, voided_at, disputed_at, dispute_reason",
      )
      .eq("tenant_id", tenantId)
      .neq("status", "DRAFT")
      .lte("issue_date", reportingDate)
      .returns<InvoiceRow[]>();
    if (error) throw new Error(`[aging] invoice read failed: ${error.message}`);

    const invoices = invoiceRows ?? [];
    if (invoices.length === 0) {
      return buildAgingReport([], {
        tenantId,
        reportingDate,
        currency: query.currency,
        averageDelayPopulation: query.averageDelayPopulation,
      });
    }

    const invoiceIds = invoices.map((i) => i.id);
    const clientIds = [...new Set(invoices.map((i) => i.client_id).filter(Boolean))] as string[];
    const fileIds = [...new Set(invoices.map((i) => i.file_id).filter(Boolean))] as string[];

    // Batched, never one query per receivable.
    const [lineRes, payRes, clientRes, fileRes, followUpRes] = await Promise.all([
      supabase
        .from("invoice_line")
        .select("invoice_id, quantity, unit_amount, tax_rate")
        .eq("tenant_id", tenantId)
        .in("invoice_id", invoiceIds)
        .returns<LineRow[]>(),
      supabase
        .from("payment")
        .select("invoice_id, amount, paid_at, reversed_at")
        .eq("tenant_id", tenantId)
        .in("invoice_id", invoiceIds)
        .returns<PaymentRow[]>(),
      clientIds.length
        ? supabase.from("client").select("id, name").eq("tenant_id", tenantId).in("id", clientIds).returns<ClientRow[]>()
        : Promise.resolve({ data: [] as ClientRow[] }),
      fileIds.length
        ? supabase
            .from("operational_file")
            .select("id, file_number")
            .eq("tenant_id", tenantId)
            .in("id", fileIds)
            .returns<FileRow[]>()
        : Promise.resolve({ data: [] as FileRow[] }),
      supabase
        .from("collection_follow_up")
        .select("invoice_id, note, created_at")
        .eq("tenant_id", tenantId)
        .in("invoice_id", invoiceIds)
        .order("created_at", { ascending: false })
        .returns<FollowUpRow[]>(),
    ]);

    const linesByInvoice = new Map<string, LineRow[]>();
    for (const l of lineRes.data ?? []) {
      const list = linesByInvoice.get(l.invoice_id);
      if (list) list.push(l);
      else linesByInvoice.set(l.invoice_id, [l]);
    }

    const paymentsByInvoice = new Map<string, PaymentRow[]>();
    for (const p of payRes.data ?? []) {
      const list = paymentsByInvoice.get(p.invoice_id);
      if (list) list.push(p);
      else paymentsByInvoice.set(p.invoice_id, [p]);
    }

    const clientNames = new Map((clientRes.data ?? []).map((c) => [c.id, c.name] as const));
    const fileNumbers = new Map((fileRes.data ?? []).map((f) => [f.id, f.file_number ?? null] as const));

    // Most recent follow-up note per invoice — the « Commentaires » column of
    // Dossiers Critiques, read from the permanent collection record rather than
    // a second store (Q-10's recommended reading).
    const latestNote = new Map<string, string>();
    for (const f of followUpRes.data ?? []) {
      if (!latestNote.has(f.invoice_id) && f.note) latestNote.set(f.invoice_id, f.note);
    }

    const inputs: InvoiceInput[] = [];
    for (const inv of invoices) {
      // An invoice with no number or no issue date cannot be reported on; it is a
      // data defect, not a receivable. Skipping is safe because such a row cannot
      // be an issued invoice under the platform's own numbering rules.
      if (!inv.invoice_number || !inv.issue_date) continue;

      const lines = linesByInvoice.get(inv.id) ?? [];
      const originalMinor = lines.reduce((sum, l) => sum + lineTotalMinorUnits(l), 0);

      const allocations: Allocation[] = [];
      for (const p of paymentsByInvoice.get(inv.id) ?? []) {
        allocations.push({
          kind: "PAYMENT",
          amount: toMoney(p.amount),
          effectiveDate: isoDate(p.paid_at.slice(0, 10)),
          // A reversal is DATED, so one recorded after the arrêté leaves the
          // historical figure intact — the engine applies that rule.
          reversedOn: p.reversed_at ? isoDate(p.reversed_at.slice(0, 10)) : null,
        });
      }
      // Credit notes and adjustments have no tables yet (deferred, D-02/D-03).
      // Their absence is an empty list, not a special case: the engine's formula
      // already accounts for them and needs no change when they arrive.

      inputs.push({
        tenantId,
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        clientId: inv.client_id ?? "",
        clientName: (inv.client_id && clientNames.get(inv.client_id)) || "—",
        dossierReference: inv.file_id ? (fileNumbers.get(inv.file_id) ?? null) : null,
        externalDossierReference: inv.legacy_file_reference,
        currency: inv.currency ?? "XOF",
        issueDate: isoDate(inv.issue_date),
        dueDate: inv.due_date ? isoDate(inv.due_date) : null,
        status: inv.status as InvoiceStatus,
        originalAmount: money(originalMinor),
        cancelledOn: inv.voided_at ? isoDate(inv.voided_at.slice(0, 10)) : null,
        disputed: inv.disputed_at != null,
        disputeReason: inv.dispute_reason,
        allocations,
        source: inv.provenance ?? null,
        comment: latestNote.get(inv.id) ?? null,
      });
    }

    return buildAgingReport(inputs, {
      tenantId,
      reportingDate,
      currency: query.currency,
      averageDelayPopulation: query.averageDelayPopulation,
    });
  },
);

/**
 * The currencies that actually have open receivables, so the picker offers real
 * choices instead of a hardcoded list. Cheap: one projection, no joins.
 */
export const getAgingCurrencies = cache(async (tenantId: string): Promise<string[]> => {
  const supabase = getAdminSupabaseClient();
  const { data } = await supabase
    .from("invoice")
    .select("currency")
    .eq("tenant_id", tenantId)
    .in("status", ["ISSUED", "PARTIALLY_PAID"])
    .returns<{ currency: string | null }[]>();
  const set = new Set((data ?? []).map((r) => r.currency ?? "XOF"));
  if (set.size === 0) set.add("XOF");
  return [...set].sort();
});

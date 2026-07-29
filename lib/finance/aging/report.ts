/**
 * The five-tab Aging Balance report view model. PURE — the whole engine's output.
 * ---------------------------------------------------------------------------
 * ONE report model feeds all five views. The dashboard, the raw rows, the client
 * analysis, the critical list and the charts are projections of the same
 * computation, so they cannot disagree — and `reconciliation` proves it on every
 * build rather than trusting it.
 *
 * ===========================================================================
 * WHAT THIS FILE MUST NEVER IMPORT
 * ===========================================================================
 * No Excel library, no PDF library, no UI component, no Supabase client, no
 * Next.js server action, no storage client. The engine takes assembled inputs
 * and returns a plain object; every renderer formats that object and none of
 * them recalculates. Business rules living inside an exporter is precisely the
 * failure mode this architecture exists to prevent.
 *
 * NO CLOCK either — `reportingDate` is a parameter. Identical inputs always
 * produce an identical view model, which is what makes a finalized snapshot
 * reproducible years later.
 */
import { ZERO, compareDesc, money, sum, type Money } from "./money";
import { differenceInDays, type IsoDate } from "./dates";
import {
  AGING_BALANCE_V1,
  BUCKET_SCHEME_KEY,
  RISK_LABEL_DASHBOARD_FR,
  RISK_LABEL_FR,
  bucketScheme,
  classifyDays,
  clientRisk,
  isCritical,
  type BucketDefinition,
  type BucketKey,
} from "./buckets";
import { balanceAsOf, isCancelledAsOf, isIssuedAsOf } from "./balance";
import { apportionBasisPoints } from "./share";
import type {
  AgingReportOptions,
  AgingReportViewModel,
  AgingRow,
  BucketAggregate,
  ChartSeries,
  ClientAggregate,
  Exclusion,
  InvoiceInput,
  ReconciliationCheck,
  ReportKpis,
  UnappliedCredit,
} from "./types";

const DEFAULT_TOP_CLIENTS = 10;

export class AgingEngineError extends Error {
  constructor(message: string) {
    super(`[aging/report] ${message}`);
    this.name = "AgingEngineError";
  }
}

/**
 * Round to a whole number of days, half away from zero.
 *
 * Averages of integer day counts are the only rounding in the engine. Half-up on
 * the magnitude keeps −0.5 → −1 rather than 0, so a portfolio that is not yet
 * due does not drift towards looking due.
 */
function roundDays(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const v of values) total += v;
  return roundDays(total / values.length);
}

// ---------------------------------------------------------------------------
// Population: which receivables are aged, and why the others are not
// ---------------------------------------------------------------------------

type Selection = {
  rows: AgingRow[];
  exclusions: Exclusion[];
  unappliedCredits: UnappliedCredit[];
};

function selectPopulation(
  invoices: readonly InvoiceInput[],
  options: Required<Pick<AgingReportOptions, "tenantId" | "reportingDate" | "currency">>,
  scheme: readonly BucketDefinition[],
): Selection {
  const { tenantId, reportingDate, currency } = options;
  const rows: AgingRow[] = [];
  const exclusions: Exclusion[] = [];
  const unappliedCredits: UnappliedCredit[] = [];

  for (const inv of invoices) {
    // Tenancy is asserted, not assumed. The engine has no database to scope it
    // for us, so a caller mixing tenants is a bug we refuse to render.
    if (inv.tenantId !== tenantId) {
      throw new AgingEngineError(
        `invoice ${inv.invoiceNumber} belongs to tenant ${inv.tenantId}, report is for ${tenantId}`,
      );
    }

    const balance = balanceAsOf(inv, reportingDate);
    const base = {
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber,
      clientId: inv.clientId,
      clientName: inv.clientName,
      currency: inv.currency,
    };

    if (balance.overpayment > 0) {
      // The receivable is zero; the excess is a separate credit, never netted
      // against another invoice by arithmetic nobody authorised.
      unappliedCredits.push({ ...base, amount: balance.overpayment });
    }

    // Currency is preserved, never converted. Multi-currency is an unresolved
    // decision (Q-09), so a foreign row is shown as excluded rather than summed
    // into a total that would silently mean nothing.
    if (inv.currency !== currency) {
      exclusions.push({ ...base, reason: "FOREIGN_CURRENCY", outstanding: balance.outstanding });
      continue;
    }
    if (!isIssuedAsOf(inv, reportingDate)) {
      exclusions.push({
        ...base,
        reason: inv.status === "DRAFT" ? "DRAFT" : "NOT_YET_ISSUED",
        outstanding: balance.outstanding,
      });
      continue;
    }
    if (isCancelledAsOf(inv, reportingDate)) {
      exclusions.push({ ...base, reason: "CANCELLED", outstanding: ZERO });
      continue;
    }
    if (balance.outstanding === 0) {
      exclusions.push({
        ...base,
        reason: balance.fullySettled ? "SETTLED" : "ZERO_BALANCE",
        outstanding: ZERO,
      });
      continue;
    }
    if (inv.dueDate === null) {
      // The platform will not invent a commitment the business never made. The
      // money is still reported — unaged, in the exceptions.
      exclusions.push({ ...base, reason: "MISSING_DUE_DATE", outstanding: balance.outstanding });
      continue;
    }

    // A partial payment reduced the amount; the clock still runs from the
    // contractual due date, never from the payment.
    const daysOverdue = differenceInDays(inv.dueDate, reportingDate);
    const bucket = classifyDays(daysOverdue, scheme);

    rows.push({
      tenantId,
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber,
      clientId: inv.clientId,
      clientName: inv.clientName,
      dossierReference: inv.dossierReference,
      externalDossierReference: inv.externalDossierReference ?? null,
      currency: inv.currency,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      originalAmount: balance.original,
      outstanding: balance.outstanding,
      daysOverdue,
      bucket: bucket.key,
      bucketLabelFr: bucket.labelFr,
      risk: bucket.risk,
      riskLabelFr: RISK_LABEL_FR[bucket.risk],
      disputed: inv.disputed,
      comment: inv.comment ?? null,
      source: inv.source ?? null,
    });
  }

  // Deterministic order (D-09 pending): invoice number ascending. Stable, and
  // independent of the caller's input order.
  //
  // The exception lists are sorted too, not just the rows. They are part of a
  // finalized snapshot and appear in exports, so leaving them in whatever order
  // the caller's query happened to return would make two runs over identical
  // data produce different artifacts — and therefore different hashes.
  const byNumber = (a: { invoiceNumber: string }, b: { invoiceNumber: string }) =>
    a.invoiceNumber.localeCompare(b.invoiceNumber, "fr");
  rows.sort(byNumber);
  exclusions.sort(byNumber);
  unappliedCredits.sort(byNumber);
  return { rows, exclusions, unappliedCredits };
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

function aggregateBuckets(
  rows: readonly AgingRow[],
  scheme: readonly BucketDefinition[],
): BucketAggregate[] {
  const byBucket = new Map<BucketKey, AgingRow[]>();
  for (const b of scheme) byBucket.set(b.key, []);
  for (const r of rows) byBucket.get(r.bucket)!.push(r);

  // All seven buckets always appear, zeros included: an empty tranche is
  // information, and a table that silently loses a row is a table nobody can
  // reconcile against last month's.
  const amounts = scheme.map((b) => sum(byBucket.get(b.key)!.map((r) => r.outstanding)));
  const shares = apportionBasisPoints(amounts);

  return scheme.map((b, i) => {
    const bucketRows = byBucket.get(b.key)!;
    return {
      bucket: b.key,
      labelFr: b.labelFr,
      risk: b.risk,
      riskLabelFr: RISK_LABEL_FR[b.risk],
      riskLabelDashboardFr: RISK_LABEL_DASHBOARD_FR[b.risk],
      invoiceCount: bucketRows.length,
      amount: amounts[i],
      shareBasisPoints: shares[i],
      clientCount: new Set(bucketRows.map((r) => r.clientId)).size,
      averageDaysOverdue: mean(bucketRows.map((r) => r.daysOverdue)),
    };
  });
}

function aggregateClients(
  rows: readonly AgingRow[],
  scheme: readonly BucketDefinition[],
): ClientAggregate[] {
  const byClient = new Map<string, AgingRow[]>();
  for (const r of rows) {
    const list = byClient.get(r.clientId);
    if (list) list.push(r);
    else byClient.set(r.clientId, [r]);
  }

  const grouped = [...byClient.entries()].map(([clientId, clientRows]) => ({
    clientId,
    clientName: clientRows[0].clientName,
    rows: clientRows,
    amount: sum(clientRows.map((r) => r.outstanding)),
  }));

  // « Classement décroissant par encours ». Name breaks ties so the ranking is
  // stable rather than dependent on Map insertion order.
  grouped.sort((a, b) => compareDesc(a.amount, b.amount) || a.clientName.localeCompare(b.clientName, "fr"));

  const shares = apportionBasisPoints(grouped.map((g) => g.amount));

  return grouped.map((g, i) => {
    const days = g.rows.map((r) => r.daysOverdue);
    const average = mean(days)!; // non-empty by construction
    const risk = clientRisk(average, scheme);
    return {
      clientId: g.clientId,
      clientName: g.clientName,
      invoiceCount: g.rows.length,
      amount: g.amount,
      averageDaysOverdue: average,
      maxDaysOverdue: Math.max(...days),
      shareBasisPoints: shares[i],
      risk,
      riskLabelFr: RISK_LABEL_FR[risk],
    };
  });
}

function buildKpis(
  rows: readonly AgingRow[],
  population: NonNullable<AgingReportOptions["averageDelayPopulation"]>,
): ReportKpis {
  const overdueRows = rows.filter((r) => r.daysOverdue >= 1);
  const delayPopulation = population === "OVERDUE_ONLY" ? overdueRows : rows;

  return {
    totalOutstanding: sum(rows.map((r) => r.outstanding)),
    invoiceCount: rows.length,
    clientCount: new Set(rows.map((r) => r.clientId)).size,
    overdueAmount: sum(overdueRows.map((r) => r.outstanding)),
    averageDaysOverdue: mean(delayPopulation.map((r) => r.daysOverdue)),
    averageDelayPopulation: population,
    amountOverOneYear: sum(rows.filter((r) => isCritical(r.daysOverdue)).map((r) => r.outstanding)),
  };
}

function buildCharts(
  buckets: readonly BucketAggregate[],
  clients: readonly ClientAggregate[],
  topCount: number,
): { charts: AgingReportViewModel["charts"] } {
  const bucketAmounts: ChartSeries = {
    categories: buckets.map((b) => b.labelFr),
    values: buckets.map((b) => b.amount as number),
  };
  const bucketShares: ChartSeries = {
    categories: buckets.map((b) => b.labelFr),
    values: buckets.map((b) => b.shareBasisPoints),
  };
  const top = clients.slice(0, topCount);
  const topClients: ChartSeries = {
    categories: top.map((c) => c.clientName),
    values: top.map((c) => c.amount as number),
  };
  return { charts: { bucketAmounts, bucketShares, topClients } };
}

// ---------------------------------------------------------------------------
// Reconciliation — the five views must agree, and must PROVE they agree
// ---------------------------------------------------------------------------

function reconcile(vm: Omit<AgingReportViewModel, "reconciliation">): ReconciliationCheck[] {
  const checks: ReconciliationCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const bucketTotal = sum(vm.buckets.map((b) => b.amount));
  const clientTotal = sum(vm.clients.map((c) => c.amount));
  const rowTotal = sum(vm.rows.map((r) => r.outstanding));

  add("rows_total_equals_kpi", rowTotal === vm.kpis.totalOutstanding,
    `Σ rows ${rowTotal} vs KPI ${vm.kpis.totalOutstanding}`);
  add("buckets_total_equals_rows", bucketTotal === rowTotal,
    `Σ buckets ${bucketTotal} vs Σ rows ${rowTotal}`);
  add("clients_total_equals_rows", clientTotal === rowTotal,
    `Σ clients ${clientTotal} vs Σ rows ${rowTotal}`);

  const bucketCount = vm.buckets.reduce((n, b) => n + b.invoiceCount, 0);
  const clientCount = vm.clients.reduce((n, c) => n + c.invoiceCount, 0);
  add("bucket_counts_equal_rows", bucketCount === vm.rows.length,
    `Σ bucket counts ${bucketCount} vs ${vm.rows.length} rows`);
  add("client_counts_equal_rows", clientCount === vm.rows.length,
    `Σ client counts ${clientCount} vs ${vm.rows.length} rows`);
  add("kpi_client_count_equals_clients", vm.kpis.clientCount === vm.clients.length,
    `KPI ${vm.kpis.clientCount} vs ${vm.clients.length} client rows`);

  // The critical list, the > 365 bucket and the « Montant > 1 an » card are three
  // presentations of one figure. If they ever diverge the report is lying to
  // somebody, so the engine refuses to emit it.
  const over365 = vm.buckets.find((b) => b.bucket === "OVER_365")!;
  add("critical_total_equals_over365_bucket", vm.criticalTotal.amount === over365.amount,
    `critical ${vm.criticalTotal.amount} vs bucket ${over365.amount}`);
  add("critical_count_equals_over365_bucket", vm.criticalTotal.invoiceCount === over365.invoiceCount,
    `critical ${vm.criticalTotal.invoiceCount} vs bucket ${over365.invoiceCount}`);
  add("kpi_over_one_year_equals_critical", vm.kpis.amountOverOneYear === vm.criticalTotal.amount,
    `KPI ${vm.kpis.amountOverOneYear} vs critical ${vm.criticalTotal.amount}`);

  const bucketShareSum = vm.buckets.reduce((n, b) => n + b.shareBasisPoints, 0);
  const clientShareSum = vm.clients.reduce((n, c) => n + c.shareBasisPoints, 0);
  const expected = vm.rows.length === 0 ? 0 : 10_000;
  add("bucket_shares_sum_to_100", bucketShareSum === expected, `${bucketShareSum} bp`);
  add("client_shares_sum_to_100", clientShareSum === expected, `${clientShareSum} bp`);

  add("charts_derive_from_buckets",
    vm.charts.bucketAmounts.values.length === vm.buckets.length &&
      vm.charts.bucketShares.values.length === vm.buckets.length,
    "chart series length matches the bucket table");
  add("top_clients_prefix_of_clients",
    vm.charts.topClients.categories.every((name, i) => vm.clients[i]?.clientName === name),
    "Top-N is the head of the client ranking");

  return checks;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the five-tab report view model.
 *
 * Deterministic: same inputs, same output, always. No clock, no randomness, no
 * `Intl` (locale data differs between runtimes and would break the hash of a
 * finalized artifact) — `localeCompare` is used only for ordering, never for
 * anything that reaches a rendered figure.
 *
 * Throws when the five views cannot be reconciled. That is an engine defect, not
 * a data condition, and shipping a self-contradicting balance sheet is worse
 * than failing loudly.
 */
export function buildAgingReport(
  invoices: readonly InvoiceInput[],
  options: AgingReportOptions,
): AgingReportViewModel {
  const schemeKey = options.schemeKey ?? BUCKET_SCHEME_KEY;
  const scheme = bucketScheme(schemeKey) ?? AGING_BALANCE_V1;
  const population = options.averageDelayPopulation ?? "ALL_ROWS";
  const topCount = options.topClientCount ?? DEFAULT_TOP_CLIENTS;

  const { rows, exclusions, unappliedCredits } = selectPopulation(
    invoices,
    { tenantId: options.tenantId, reportingDate: options.reportingDate, currency: options.currency },
    scheme,
  );

  const buckets = aggregateBuckets(rows, scheme);
  const clients = aggregateClients(rows, scheme);
  const kpis = buildKpis(rows, population);
  const { charts } = buildCharts(buckets, clients, topCount);

  const critical = rows
    .filter((r) => isCritical(r.daysOverdue))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.invoiceNumber.localeCompare(b.invoiceNumber, "fr"));

  const partial: Omit<AgingReportViewModel, "reconciliation"> = {
    tenantId: options.tenantId,
    reportingDate: options.reportingDate as IsoDate,
    currency: options.currency,
    schemeKey,
    rows,
    kpis,
    buckets,
    clients,
    critical,
    criticalTotal: {
      amount: sum(critical.map((r) => r.outstanding)),
      invoiceCount: critical.length,
    },
    charts,
    exclusions,
    unappliedCredits,
  };

  const reconciliation = reconcile(partial);
  const failed = reconciliation.filter((c) => !c.ok);
  if (failed.length > 0) {
    throw new AgingEngineError(
      `report failed reconciliation: ${failed.map((f) => `${f.name} (${f.detail})`).join("; ")}`,
    );
  }

  return { ...partial, reconciliation };
}

export { money, ZERO, type Money };

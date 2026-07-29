/**
 * Engine contracts. PURE types — no runtime imports beyond sibling pure modules.
 * ---------------------------------------------------------------------------
 * Every contract carries `tenantId`. The engine never reaches a database, so it
 * cannot enforce tenancy itself; carrying the id through means the caller cannot
 * assemble a report from two tenants' rows without the type system noticing, and
 * the engine asserts the invariant rather than trusting it.
 */
import type { Money } from "./money";
import type { IsoDate } from "./dates";
import type { BucketKey, RiskKey, BucketSchemeKey } from "./buckets";

/** Where an allocation moves the balance. Signs are applied by the engine, not the caller. */
export const ALLOCATION_KINDS = [
  "PAYMENT",
  "CREDIT_NOTE",
  "ADJUSTMENT_CREDIT",
  "ADJUSTMENT_DEBIT",
] as const;
export type AllocationKind = (typeof ALLOCATION_KINDS)[number];

/**
 * One movement against an invoice.
 *
 * `effectiveDate` is the ACCOUNTING date (payment `paid_at`, credit-note or
 * adjustment effective date) — not the row's creation timestamp. A payment
 * entered late but dated inside the period still belongs to the period.
 *
 * `reversedOn` is likewise a date, so a reversal that happens AFTER the arrêté
 * does not rewrite the arrêté (ratified: post-reporting-date transactions must
 * not affect historical results).
 *
 * Amounts are always POSITIVE magnitudes; direction comes from `kind`.
 */
export type Allocation = {
  kind: AllocationKind;
  amount: Money;
  effectiveDate: IsoDate;
  reversedOn: IsoDate | null;
  /** Opaque id for traceability back to payment/credit-note rows. */
  sourceId?: string;
};

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * The engine's view of one receivable. Assembled by a future data layer from
 * `invoice` + `invoice_line` + `payment` (+ credit notes / adjustments when those
 * land); the engine itself does no I/O.
 */
export type InvoiceInput = {
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  /** Copied, not looked up: a later client rename must not rewrite an old report. */
  clientName: string;
  /** Platform dossier reference, when the invoice is attached to one. */
  dossierReference: string | null;
  /**
   * Legacy dossier reference carried from an opening import when no platform
   * dossier matched (D-01). Displayed as-is; never fabricated into a dossier.
   */
  externalDossierReference?: string | null;
  currency: string;
  issueDate: IsoDate;
  /** May be absent. An invoice without a due date is NEVER called overdue. */
  dueDate: IsoDate | null;
  status: InvoiceStatus;
  /** Original gross amount, retained alongside the outstanding balance (Q-01). */
  originalAmount: Money;
  /** Date the invoice was cancelled/voided, if it was. Exclusion is as-of. */
  cancelledOn: IsoDate | null;
  disputed: boolean;
  disputeReason?: string | null;
  allocations: readonly Allocation[];
  /** Provenance marker, e.g. "OPENING_IMPORT" (D-01). Presentation + audit only. */
  source?: string | null;
  /** Collection comment as captured for this report (Dossiers Critiques col H). */
  comment?: string | null;
};

/** A row that made it into the report. */
export type AgingRow = {
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  dossierReference: string | null;
  externalDossierReference: string | null;
  currency: string;
  issueDate: IsoDate;
  dueDate: IsoDate;
  /** Q-01: the original gross, kept internally and available to renderers. */
  originalAmount: Money;
  /** Q-01: what every aggregate and every displayed « Montant » uses. */
  outstanding: Money;
  daysOverdue: number;
  bucket: BucketKey;
  bucketLabelFr: string;
  risk: RiskKey;
  riskLabelFr: string;
  disputed: boolean;
  comment: string | null;
  source: string | null;
};

/** Why a receivable did not make it into the aged population. */
export const EXCLUSION_REASONS = [
  "DRAFT",
  "CANCELLED",
  "SETTLED",
  "ZERO_BALANCE",
  "MISSING_DUE_DATE",
  "FOREIGN_CURRENCY",
  "NOT_YET_ISSUED",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/**
 * An excluded receivable, WITH ITS REASON.
 *
 * Exclusions are reported, never silent. A missing due date is the clearest
 * case: the platform will not invent a commitment the business never made, and
 * it will not hide the money either — the amount is stated, unaged.
 */
export type Exclusion = {
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  currency: string;
  reason: ExclusionReason;
  outstanding: Money;
};

/** An overpaid invoice: the receivable is zero, the excess is a separate credit. */
export type UnappliedCredit = {
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  currency: string;
  /** Positive magnitude of the overpayment. Never nets against another invoice. */
  amount: Money;
};

export type BucketAggregate = {
  bucket: BucketKey;
  labelFr: string;
  risk: RiskKey;
  riskLabelFr: string;
  /** Dashboard variant — « 🟠 Modéré ». */
  riskLabelDashboardFr: string;
  invoiceCount: number;
  amount: Money;
  /** Share of total outstanding, in basis points. Bucket shares sum to exactly 10000. */
  shareBasisPoints: number;
  clientCount: number;
  averageDaysOverdue: number | null;
};

export type ClientAggregate = {
  clientId: string;
  clientName: string;
  invoiceCount: number;
  amount: Money;
  averageDaysOverdue: number;
  maxDaysOverdue: number;
  /** Client shares sum to exactly 10000 basis points. */
  shareBasisPoints: number;
  risk: RiskKey;
  riskLabelFr: string;
};

/**
 * How « Retard moyen » on the dashboard is populated. UNRESOLVED (Q-04) — the
 * reference workbook's KPI cell was blanked by anonymization, so the population
 * cannot be recovered from the file. It is an explicit input with a stated
 * default rather than a silent guess, and the chosen value travels in the view
 * model so the renderer can disclose it.
 */
export const AVERAGE_DELAY_POPULATIONS = ["ALL_ROWS", "OVERDUE_ONLY"] as const;
export type AverageDelayPopulation = (typeof AVERAGE_DELAY_POPULATIONS)[number];

export type ReportKpis = {
  totalOutstanding: Money;
  invoiceCount: number;
  clientCount: number;
  overdueAmount: Money;
  averageDaysOverdue: number | null;
  averageDelayPopulation: AverageDelayPopulation;
  amountOverOneYear: Money;
};

export type ChartSeries = {
  /** Category labels, in render order. */
  categories: readonly string[];
  values: readonly number[];
};

export type ReportCharts = {
  /** Chart 1 — « Encours par tranche d'ancienneté (FCFA) », vertical bars. */
  bucketAmounts: ChartSeries;
  /** Chart 2 — « Répartition % de l'encours par tranche », pie (basis points). */
  bucketShares: ChartSeries;
  /** Chart 3 — « Top 10 clients – Encours (FCFA) », horizontal bars. */
  topClients: ChartSeries;
};

export type ReconciliationCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type AgingReportOptions = {
  tenantId: string;
  reportingDate: IsoDate;
  /** One report, one currency. Foreign-currency rows are excluded, never converted. */
  currency: string;
  schemeKey?: BucketSchemeKey;
  averageDelayPopulation?: AverageDelayPopulation;
  /** How many clients the Top-N chart carries. The workbook uses 10. */
  topClientCount?: number;
};

/**
 * The five-tab report view model — the SINGLE source every renderer reads.
 * Web, XLSX, PDF and print all format this object; none of them recalculates.
 */
export type AgingReportViewModel = {
  tenantId: string;
  reportingDate: IsoDate;
  currency: string;
  schemeKey: BucketSchemeKey;
  /** 📋 Données Brutes */
  rows: readonly AgingRow[];
  /** 📊 Tableau de Bord — KPI cards */
  kpis: ReportKpis;
  /** 📊 Tableau de Bord — the seven-bucket table (always all seven, zeros included) */
  buckets: readonly BucketAggregate[];
  /** 👥 Analyse Clients — ranked descending by outstanding */
  clients: readonly ClientAggregate[];
  /** ⛔ Dossiers Critiques — days > 365, descending */
  critical: readonly AgingRow[];
  criticalTotal: { amount: Money; invoiceCount: number };
  /** 📈 Graphiques */
  charts: ReportCharts;
  exclusions: readonly Exclusion[];
  unappliedCredits: readonly UnappliedCredit[];
  reconciliation: readonly ReconciliationCheck[];
};

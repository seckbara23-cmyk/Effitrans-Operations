/**
 * Analytics shared types (Phase 1.13). Client + server safe.
 */

/** Per-invoice summary the analytics calc operates on (totals via finance calc). */
export type InvoiceAgg = {
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  clientId: string | null;
  total: number;
  paid: number;
  balance: number;
};

export type FinancialKpis = {
  revenueThisMonth: number;
  revenueYtd: number;
  outstanding: number;
  overdue: number;
  invoicesIssuedThisMonth: number;
  collectionRate: number; // %
};

export type OperationsKpis = {
  active: number;
  newThisMonth: number;
  delivered: number;
  closed: number;
  highPriority: number;
  blocked: number;
};

export type CustomsKpis = {
  pending: number;
  underReview: number;
  inspection: number;
  released: number;
  avgReleaseDays: number | null;
};

export type TransportKpis = {
  planned: number;
  inTransit: number;
  delivered: number;
  podReceived: number;
  onTimePct: number | null;
};

export type PortalKpis = {
  users: number;
  activeClients: number;
  sharedDocuments: number;
  downloads: number;
  invoiceViews: number;
};

export type TeamKpis = {
  openTasks: number;
  completedTasks: number;
  customsReleases: number;
  invoicesIssued: number;
  avgClosureDays: number | null;
};

export type Bar = { label: string; value: number };
export type TrendPoint = { month: string; value: number };

export type AnalyticsCharts = {
  revenueTrend: TrendPoint[] | null; // null when finance is hidden
  statusDistribution: Bar[];
  revenueByClient: Bar[] | null;
  customsPipeline: Bar[];
  transportPipeline: Bar[];
};

export type AnalyticsData = {
  currency: string;
  financial: FinancialKpis | null; // null when the viewer lacks finance:read
  operations: OperationsKpis;
  customs: CustomsKpis;
  transport: TransportKpis;
  portal: PortalKpis;
  team: TeamKpis;
  charts: AnalyticsCharts;
};

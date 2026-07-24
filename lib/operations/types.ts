/**
 * Centre d'Opérations — cockpit view model (Phase 10.0B). PURE TYPES.
 * ---------------------------------------------------------------------------
 * The cockpit is a PROJECTION over the existing bounded readers — it owns no
 * table, no mutation and no business rule (DEC-B29, phase-10.0a §19). Three
 * doctrines are encoded in these types, all inherited from the executive model:
 *
 *  1. MISSING ≠ NEGATIVE. Every section is nullable; `null` means "this viewer
 *     cannot read it / the source is dark / the read failed" — never zero.
 *  2. EVERY FIGURE IS TRACEABLE. Section models re-expose the OWNING module's
 *     own shapes (FileOverview, HeadlineKpis, ExecutiveKpis, FinanceKpis…)
 *     rather than re-declaring numbers the cockpit did not compute.
 *  3. NO INVENTED SEVERITY. Alerts are `ExecutiveAlert`s produced by the
 *     existing normalization + merge engine (lib/executive/compose).
 *
 * Type-only imports from server-only modules are erased at compile time, so
 * this file stays importable from pure unit tests.
 */
import type { FileOverview } from "@/lib/files/aggregate";
import type { ProcessTower } from "@/lib/process/queues/control-tower";
import type { HeadlineKpis } from "@/lib/logistics/compose";
import type { PlatformCard } from "@/lib/logistics/reader";
import type { ExecutiveKpis } from "@/lib/control-tower/service";
import type { FinanceKpis } from "@/lib/finance/types";
import type { FinanceRequestStatus, EvidenceStatus } from "@/lib/finance/requests";
import type { MessagingDashboardSummary } from "@/lib/messaging/dashboard";
import type { ExecutiveAlert, ExecutiveAlertLevel } from "@/lib/executive/types";
import type { CanonicalDepartmentCode } from "@/lib/organization/departments";

/** The cockpit's sections — used for availability + degradation reporting. */
export const COCKPIT_SECTIONS = [
  "operations", "transit", "finance", "messaging", "alerts", "kpis", "workload",
] as const;
export type CockpitSection = (typeof COCKPIT_SECTIONS)[number];

// ---------------------------------------------------------------- operations ----

export type CockpitTaskKpis = { dueToday: number; overdue: number; mine: number };

export type CockpitOperations = {
  /** lib/files aggregate — active/opened/delivered/highPriority/overdueShipments. */
  files: FileOverview | null;
  tasks: CockpitTaskKpis | null;
  /** Engine process tower (~30 stage counters). Null when the workspaces flag is off. */
  processTower: ProcessTower | null;
};

// ---------------------------------------------------------------- transit ----

export type CockpitTransit = {
  /** Command Center cross-modal headline (movements, arrivals ≤7 j, overdue, customs…). */
  headline: HeadlineKpis;
  /** The four mode cards (road / ocean / air / customs) exactly as the Command Center built them. */
  cards: PlatformCard[];
  upcomingCount: number;
  customsAuthorized: boolean;
};

// ---------------------------------------------------------------- finance ----

export type FinanceRequestQueueItem = {
  id: string;
  fileId: string;
  fileNumber: string | null;
  status: FinanceRequestStatus;
  evidenceStatus: EvidenceStatus;
  amount: number;
  currency: string;
  categoryLabel: string;
  requestedAt: string;
};

/**
 * The tenant-wide finance-request pipeline (phase-10.0a §4.3 — the single
 * biggest reader gap). Buckets mirror the finance-request lifecycle
 * (lib/finance/requests): a DISBURSED request stays visible until its evidence
 * is VERIFIED. Amounts are summed PER CURRENCY — never across currencies.
 */
export type FinanceRequestQueue = {
  pendingReview: number;
  approvedNotDisbursed: number;
  returned: number;
  evidenceMissing: number;
  evidenceToVerify: number;
  pendingAmounts: { currency: string; amount: number }[];
  oldestRequestedAt: string | null;
  /** Oldest actionable requests first, bounded. */
  items: FinanceRequestQueueItem[];
};

export type CockpitFinance = {
  /** getFinanceKpis() — outstanding / overdueCount / draftCount / issuedCount. */
  invoices: FinanceKpis | null;
  revenueThisMonth: number | null;
  reconciliation: { pending: number; missingReference: number; failedIntents: number } | null;
  /** Null when finance execution is dark or migration 20260723000002 is absent. */
  requests: FinanceRequestQueue | null;
  /** Open receivable dossiers in Collections. Null when the flag is off / no collections:manage. */
  collectionsOpen: number | null;
  currency: string;
};

// ---------------------------------------------------------------- messaging ----

export type CockpitMessaging = {
  /** RLS-scoped total unread for THIS viewer (the nav-badge number). */
  unread: number;
  /** Customer-support summary — null without messaging:manage. */
  summary: MessagingDashboardSummary | null;
};

// ---------------------------------------------------------------- alerts ----

export type CockpitAlerts = {
  items: ExecutiveAlert[];
  counts: Record<ExecutiveAlertLevel, number>;
};

// ---------------------------------------------------------------- KPIs ----

export type CockpitKpis = {
  /** Control-tower executive KPI row (analytics:read) — active, delivered, revenue, outstanding, avg days. */
  executive: ExecutiveKpis | null;
};

// ---------------------------------------------------------------- workload ----

export type WorkloadEntry = { key: string; labelFr: string; open: number };
export type DepartmentWorkloadEntry = WorkloadEntry & { key: CanonicalDepartmentCode };
export type UserWorkloadEntry = { userId: string; displayName: string; open: number };

/**
 * Workload = open engine step executions, GROUPED — coordination data, never a
 * performance score (DEC-B30). `byUser` is restricted to the platform's
 * established supervision boundary (analytics:read) and is null for everyone
 * else; such viewers still get the aggregated department/team rows.
 */
export type CockpitWorkload = {
  /** The 15 engine queues rolled up to the canonical departments (display metadata only). */
  byDepartment: DepartmentWorkloadEntry[];
  /** Raw per-queue depth (the same numbers the nav badges use). */
  byQueue: WorkloadEntry[];
  /** Transit teams (AIBD / MARITIME). Null when the engine is dark. */
  byTeam: WorkloadEntry[] | null;
  /** Named per-person open work — analytics:read only (DEC-B30). */
  byUser: UserWorkloadEntry[] | null;
};

// ---------------------------------------------------------------- root ----

export type OperationsCockpit = {
  generatedAt: string;
  sections: CockpitSection[];
  unavailable: CockpitSection[];
  operations: CockpitOperations | null;
  transit: CockpitTransit | null;
  finance: CockpitFinance | null;
  messaging: CockpitMessaging | null;
  alerts: CockpitAlerts | null;
  kpis: CockpitKpis | null;
  workload: CockpitWorkload | null;
  canFinance: boolean;
  currency: string;
};

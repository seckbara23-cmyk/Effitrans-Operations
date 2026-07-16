/**
 * Executive Intelligence Dashboard — shared types (Phase 7.7). PURE.
 * ---------------------------------------------------------------------------
 * The executive model is a PROJECTION over the existing module readers, never a second source of
 * truth. Three rules are encoded in these types:
 *
 *  1. EVERY KPI IS TRACEABLE. `ExecutiveKpi` carries `source` (the authoritative reader that
 *     produced it) and `href` (the operational workspace that owns it). A number with no
 *     authoritative source cannot be represented.
 *  2. MISSING ≠ NEGATIVE. Every section carries availability. A section the viewer cannot read
 *     (or whose reader failed) is `unavailable` — never rendered as a confident zero.
 *  3. NO INVENTED SEVERITY. `ExecutiveAlert.level` is NORMALIZED from the severity the owning
 *     engine already assigned (see compose.ts); the executive layer never scores an alert itself.
 */

/** The dashboard's rows/sections — used for availability + degradation reporting. */
export const EXECUTIVE_SECTIONS = [
  "operations", "shipping", "air", "road", "customs", "financial",
  "customers", "documents", "ai", "map", "timeline", "alerts",
] as const;
export type ExecutiveSection = (typeof EXECUTIVE_SECTIONS)[number];

/** The authoritative readers an executive figure may come from. Traceability, not decoration. */
export const KPI_SOURCES = [
  "control-tower", "business-intelligence", "command-center", "shipping-dashboard",
  "air-dashboard", "customs-intelligence", "docintel-dashboard", "copilot-usage",
  "portal-ops", "fleet-map",
] as const;
export type KpiSource = (typeof KPI_SOURCES)[number];

/** One executive figure. `value === null` means NOT AVAILABLE — never "zero". */
export type ExecutiveKpi = {
  key: string;
  label: string;
  value: number | null;
  /** formatted display (currency/duration); null → the UI shows the unavailable dash */
  display: string | null;
  unit?: "count" | "currency" | "days" | "percent" | "ms";
  /** the authoritative reader this figure came from (traceability) */
  source: KpiSource;
  /** drill-down target — the operational workspace that OWNS this number */
  href: string;
};

/** Consolidated alert priority. NORMALIZED from each engine's own severity — never recomputed. */
export const ALERT_LEVELS = ["critical", "high", "medium", "low"] as const;
export type ExecutiveAlertLevel = (typeof ALERT_LEVELS)[number];

export type ExecutiveAlert = {
  level: ExecutiveAlertLevel;
  /** the module whose alert engine raised this */
  origin: string;
  reference: string | null;
  clientName: string | null;
  reason: string;
  /** drill-down into the owning workspace */
  href: string;
  occurredAt: string | null;
  /** the raw severity token the owning engine assigned (audit trail for the normalization) */
  sourceSeverity: string;
};

/** One merged, chronologically sorted operational event. No new event store. */
export type ExecutiveTimelineEntry = {
  at: string;
  origin: "shipping" | "air" | "road" | "customs" | "customer" | "documents" | "finance";
  title: string;
  reference: string | null;
  clientName: string | null;
  href: string;
};

/** An aggregate map marker. Reuses the shared projection's marker vocabulary. */
export type ExecutiveMapMarkerKind = "ship" | "aircraft" | "road" | "port" | "airport" | "warehouse" | "customs_office";

export type ExecutiveMapMarker = {
  kind: ExecutiveMapMarkerKind;
  label: string;
  latitude: number;
  longitude: number;
  /** status/freshness/confidence/source are REUSED from the existing tracking model — not invented */
  status: string | null;
  freshness: string | null;
  confidence: string | null;
  source: string | null;
  occurredAt: string | null;
  reference: string | null;
  href: string;
};

export type ExecutiveMap = {
  markers: ExecutiveMapMarker[];
  bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
  /** disclosed truncation — the map is bounded to the top-N active movements, never a full scan */
  capped: boolean;
  cap: number;
  /** stale/degraded warnings surfaced by the underlying position model */
  warnings: string[];
};

// ---------------------------------------------------------------- section payloads ----

export type OperationsOverview = {
  headline: {
    movementsInProgress: number;
    arrivingWithin7Days: number;
    overdueOps: number;
    criticalAlerts: number;
    awaitingCustoms: number;
    exceptions: number;
  } | null;
  /** per-module cards straight from the Command Center (road/ocean/air/customs) */
  modules: { mode: string; available: boolean; state: string; kpis: { label: string; value: number }[]; href: string }[];
};

export type FinancialOverview = {
  currency: string;
  revenueThisMonth: number | null;
  revenueYtd: number | null;
  outstanding: number | null;
  collectedThisMonth: number | null;
  avgInvoiceValue: number | null;
  avgPaymentDelayDays: number | null;
  aging: { bucket: string; value: number }[];
  topOverdueClients: { clientName: string | null; outstanding: number }[];
};

/** Portal adoption comes from getAnalytics().portal (authoritative); only the notification
 *  figures are sourced from the narrow executive gap-reader. */
export type CustomerIntelligence = {
  activeClients: number | null;
  portalUsers: number | null;
  portalActiveClients: number | null;
  sharedDocuments: number | null;
  portalDownloads: number | null;
  portalInvoiceViews: number | null;
  notificationsDelivered: number | null;
  notificationsUnread: number | null;
  notificationWindowDays: number;
  topOverdueClients: { clientName: string | null; outstanding: number }[];
};

export type DocumentIntelligence = {
  missingRequired: number | null;
  reviewQueue: number | null;
  failed: number | null;
  unresolvedConflicts: number | null;
  queued: number | null;
  processing: number | null;
};

export type AiIntelligence = {
  windowDays: number;
  total: number;
  answered: number;
  fallback: number;
  failed: number;
  successRatePercent: number | null;
  avgDurationMs: number | null;
  tokens: { prompt: number; completion: number; total: number } | null;
  /** provider availability — configuration state only, never a live provider probe */
  providerConfigured: boolean;
  provider: string;
  model: string;
};

export type PerformanceOverview = {
  avgCustomsDays: number | null;
  avgDeliveryDays: number | null;
  avgTransportDays: number | null;
  timeToInvoiceDays: number | null;
  timeToPaymentDays: number | null;
  /** ETA accuracy — null when no authoritative source exists (never estimated) */
  etaAccuracyPercent: number | null;
};

/** Governance detail the Phase-1.13B executive view already showed — carried through the SAME
 *  single control-tower / BI pass rather than re-read. */
export type ExecutiveGovernance = {
  sla: { department: string; normal: number; warning: number; critical: number }[];
  bottlenecks: { key: string; label: string; count: number }[];
  clients: { clientId: string; clientName: string | null; revenue: number; shipments: number; outstanding: number }[];
  needsAttention: number | null;
};

/** The whole executive snapshot. */
export type ExecutiveIntelligence = {
  generatedAt: string;
  /** sections actually composed */
  sections: ExecutiveSection[];
  /** sections NOT included — missing ≠ nothing to report */
  unavailable: ExecutiveSection[];
  kpis: ExecutiveKpi[];
  operations: OperationsOverview | null;
  financial: FinancialOverview | null;
  customers: CustomerIntelligence | null;
  documents: DocumentIntelligence | null;
  ai: AiIntelligence | null;
  performance: PerformanceOverview | null;
  governance: ExecutiveGovernance | null;
  map: ExecutiveMap | null;
  timeline: ExecutiveTimelineEntry[];
  alerts: ExecutiveAlert[];
  alertCounts: Record<ExecutiveAlertLevel, number>;
  /** true when the viewer holds finance:read — the financial row is withheld, not zeroed, without it */
  canFinance: boolean;
  currency: string;
};

export const SECTION_LABEL: Record<ExecutiveSection, string> = {
  operations: "Opérations",
  shipping: "Maritime",
  air: "Aérien",
  road: "Route",
  customs: "Douane",
  financial: "Finance",
  customers: "Clients",
  documents: "Documents",
  ai: "Intelligence artificielle",
  map: "Carte",
  timeline: "Chronologie",
  alerts: "Alertes",
};

export const ALERT_LEVEL_LABEL: Record<ExecutiveAlertLevel, string> = {
  critical: "Critique",
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
};

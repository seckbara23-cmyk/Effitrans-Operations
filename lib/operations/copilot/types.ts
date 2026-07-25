/**
 * Operations Copilot — bounded context contract (Phase 10.0F). PURE TYPES.
 * ---------------------------------------------------------------------------
 * A READ-ONLY, permission-shaped, REDACTED snapshot the copilot reasons over.
 * It carries ONLY safe normalized fields projected from the authoritative
 * composed readers (KPI engine, alert center, operations composition layer):
 * counts, statuses, safe labels and file-number references. It NEVER carries a
 * machine code, stable KPI key, alert code, entityId/UUID, href, monetary
 * amount, payment reference, provider payload or contact value — so nothing the
 * model receives can leak an identifier or a financial secret.
 *
 * The copilot owns NO business rule: every figure here was computed by an
 * existing reader; this context only re-shapes and redacts.
 */

/** Question focus — steers section emphasis only; never a permission decision. */
export const COPILOT_FOCUS = [
  "briefing", "attention", "finance", "customs", "transport", "messaging", "workload", "priorities", "kpi", "general",
] as const;
export type CopilotFocus = (typeof COPILOT_FOCUS)[number];

/** A KPI reduced to display-safe fields (no stable key, no href). */
export type CopilotKpi = { label: string; display: string; window: string; status: string };

/** An alert reduced to display-safe fields (no code, no entityId, no origin, no href). */
export type CopilotAlert = { level: string; reason: string; reference: string | null; clientName: string | null };

export type CopilotWorkloadRow = { label: string; open: number };

export type CopilotRisk = { needingIntervention: number };

export type CopilotOperations = {
  activeFiles: number | null;
  opened: number | null;
  inProgress: number | null;
  overdueShipments: number | null;
  tasksToday: number | null;
  tasksOverdue: number | null;
};

export type CopilotTransit = {
  movementsInProgress: number | null;
  arrivingWithin7Days: number | null;
  overdueOps: number | null;
  awaitingCustoms: number | null;
  customsPending: number | null;
  customsReleased: number | null;
};

/** Finance is COUNTS ONLY — never an amount or a currency figure. */
export type CopilotFinance = {
  requestsPending: number | null;
  approvedNotDisbursed: number | null;
  evidenceOwed: number | null;
  reconciliationPending: number | null;
  missingReference: number | null;
  overdueReceivables: number | null;
};

export type CopilotMessaging = {
  unread: number | null;
  waitingEffitrans: number | null;
  urgentOpen: number | null;
};

export type OperationsCopilotContext = {
  generatedAt: string;
  focus: CopilotFocus;
  /** Sections the viewer's permissions made available. */
  sections: string[];
  /** Sections NOT included (unauthorized / unavailable) — « donnée manquante ≠ absence de problème ». */
  unavailable: string[];
  kpis: CopilotKpi[];
  alerts: CopilotAlert[];
  alertCounts: { critical: number; high: number; medium: number; low: number } | null;
  /** A permitted alert source could not be read — the model must not claim « aucune alerte ». */
  alertSourcesDegraded: boolean;
  risk: CopilotRisk | null;
  operations: CopilotOperations | null;
  transit: CopilotTransit | null;
  finance: CopilotFinance | null;
  workloadByDepartment: CopilotWorkloadRow[];
  workloadByTeam: CopilotWorkloadRow[];
  messaging: CopilotMessaging | null;
  counts: { kpis: number; alerts: number; workloadDepartments: number };
};

/** The copilot's answer — text plus SAFE metadata (never a prompt or secret). */
export type OperationsCopilotResult = {
  text: string;
  focus: CopilotFocus;
  /** true when the deterministic fallback answered (AI provider unavailable). */
  fallback: boolean;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  generatedAt: string;
};

/**
 * HR-6 — performance PRIMITIVES. PURE. No imports, no I/O, no server-only.
 * ---------------------------------------------------------------------------
 * Split out of lib/hr/performance.ts for the reason lib/hr/leave/balance.ts was
 * split out of lib/hr/leave.ts: the client workspace needs the labels and the
 * weight arithmetic, and a `server-only` module cannot cross that boundary.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: money-grade arithmetic on performance.
 * Weights and achievements are integer BASIS POINTS (10000 = 100.00%). Nothing
 * here divides, averages or ranks — `formatBp` divides only to PRINT, and the
 * stored value stays an integer. An aggregate performance score is a management
 * decision (HRQ-P3), not a rendering convenience, so no function below produces
 * one.
 */

/** 10000 basis points = 100.00%. */
export const WEIGHT_TOTAL_BP = 10000;

/** Render 2500 as "25,00 %". Presentation only. */
export function formatBp(bp: number): string {
  return `${(bp / 100).toFixed(2).replace(".", ",")} %`;
}

/** Parse a percent the user typed into integer basis points. Never a float. */
export function percentToBp(input: string): number | null {
  const n = Number(String(input).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

export type CycleStatus = "DRAFT" | "OPEN" | "IN_REVIEW" | "FINALIZED" | "CANCELLED";
export type EvaluationStatus =
  | "DRAFT" | "SELF_SUBMITTED" | "MANAGER_SUBMITTED"
  | "FINALIZED" | "ACKNOWLEDGED" | "CANCELLED";

export const CYCLE_STATUS_FR: Record<CycleStatus, string> = {
  DRAFT: "Brouillon",
  OPEN: "Ouvert",
  IN_REVIEW: "En revue",
  FINALIZED: "Finalisé",
  CANCELLED: "Annulé",
};

export const EVALUATION_STATUS_FR: Record<EvaluationStatus, string> = {
  DRAFT: "À démarrer",
  SELF_SUBMITTED: "Auto-évaluation soumise",
  MANAGER_SUBMITTED: "Revue manager soumise",
  FINALIZED: "Finalisée",
  ACKNOWLEDGED: "Accusée de réception",
  CANCELLED: "Annulée",
};

/** The four stages in order — used to show WHERE a review is, not to score it. */
export const EVALUATION_STAGES: readonly EvaluationStatus[] = [
  "DRAFT", "SELF_SUBMITTED", "MANAGER_SUBMITTED", "FINALIZED", "ACKNOWLEDGED",
] as const;

export type PerformanceCycle = {
  id: string;
  code: string;
  labelFr: string;
  cycleKind: string;
  status: CycleStatus;
  periodStart: string;
  periodEnd: string;
  submissionDeadline: string | null;
  reviewDeadline: string | null;
  weightTotalBp: number;
  targetScope: string;
  finalizedAt: string | null;
};

export type Objective = {
  id: string;
  employeeId: string;
  cycleId: string;
  title: string;
  description: string | null;
  category: string | null;
  weightBp: number;
  measurableTarget: string | null;
  dueDate: string | null;
  status: string;
  progressBp: number;
  managerAchievementBp: number | null;
  managerAssessment: string | null;
  completionNote: string | null;
  evidenceDocumentId: string | null;
  version: number;
  supersedesObjectiveId: string | null;
  locked: boolean;
};

/**
 * An evaluation as the CURRENT READER may see it. The prose fields are null
 * when the reader lacks hr:sensitive:read, and `contentWithheld` says so — so
 * the UI can render « réservé » instead of an empty review, which would be a
 * different and false statement.
 */
export type Evaluation = {
  id: string;
  cycleId: string;
  employeeId: string;
  managerEmployeeId: string | null;
  status: EvaluationStatus;
  selfSubmittedAt: string | null;
  managerSubmittedAt: string | null;
  finalizedAt: string | null;
  acknowledgedAt: string | null;
  selfEnteredBy: string | null;
  managerEnteredBy: string | null;
  finalizedBy: string | null;
  contentWithheld: boolean;
  selfComments: string | null;
  managerComments: string | null;
  managerStrengths: string | null;
  managerDevelopment: string | null;
  recommendedActions: string | null;
  moderationNote: string | null;
  finalSummary: string | null;
};

export type Competency = {
  id: string; code: string; labelFr: string; description: string | null;
  category: string | null; scaleMin: number; scaleMax: number;
  scaleLabels: Record<string, string>; isActive: boolean;
};

export type CompetencyAssessment = {
  id: string; competencyId: string; selfLevel: number | null;
  managerLevel: number | null; expectedLevel: number | null; note: string | null;
};

/**
 * REPORTS the weight rule the finalize RPC enforces — it does not enforce it,
 * and it never guesses a total of its own. An employee with no live objectives
 * is finalizable: a competency-only review is legitimate, and demanding 100%
 * of an empty set would block it for no reason.
 */
export function weightCheck(objectives: Objective[], requiredBp: number): {
  totalBp: number; requiredBp: number; satisfied: boolean; applicable: boolean;
} {
  const live = objectives.filter((o) => o.status !== "CANCELLED" && o.status !== "SUPERSEDED");
  const totalBp = live.reduce((sum, o) => sum + o.weightBp, 0);
  const applicable = live.length > 0;
  return { totalBp, requiredBp, applicable, satisfied: !applicable || totalBp === requiredBp };
}

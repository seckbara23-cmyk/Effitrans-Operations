/**
 * HR-7A — payroll preparation PRIMITIVES. PURE. No imports, no I/O, no
 * server-only — split from lib/hr/payroll.ts for the reason
 * lib/hr/performance/scoring.ts was split from performance.ts: the client
 * workspace needs the labels and the read-tier rule, and a `server-only`
 * module cannot cross that boundary.
 *
 * FACTS ONLY (Q1/DEC-B63): nothing here names, stores or formats money.
 */

export type PayrollPeriodStatus = "DRAFT" | "PREPARED" | "VERIFIED" | "APPROVED" | "LOCKED" | "CANCELLED";

export const PAYROLL_STATUS_FR: Record<PayrollPeriodStatus, string> = {
  DRAFT: "Brouillon",
  PREPARED: "Faits collectés",
  VERIFIED: "Vérifiée",
  APPROVED: "Approuvée",
  LOCKED: "Verrouillée",
  CANCELLED: "Annulée",
};

/** Exception codes the collector emits; the UI renders the French sentence.
 *  The platform SURFACES anomalies, it never normalizes them (audit §11). */
export const PAYROLL_EXCEPTION_FR: Record<string, string> = {
  NO_ATTENDANCE: "Aucune présence enregistrée sur la période",
  NO_OPEN_ASSIGNMENT: "Aucune affectation ouverte",
  NO_CONTRACT_RECORD: "Aucun contrat enregistré couvrant la période",
  MISSING_HIRE_DATE: "Date d'embauche absente du dossier",
  HIRED_IN_PERIOD: "Embauché(e) pendant la période",
  TERMINATED_IN_PERIOD: "Parti(e) pendant la période",
  SUSPENDED_AT_CUTOFF: "Suspendu(e) à la date de collecte",
  LEAVE_SPANS_BOUNDARY: "Congé approuvé à cheval sur la période (quantité non proratisée)",
  LEAVE_PENDING_AT_CUTOFF: "Demande de congé non décidée sur la période",
};

export type PayrollPeriod = {
  id: string; code: string; labelFr: string;
  periodStart: string; periodEnd: string;
  status: PayrollPeriodStatus;
  cutoffAt: string | null;
  lineCount: number; draftExcludedCount: number;
  preparedBy: string | null; verifiedBy: string | null; approvedBy: string | null;
  lockedAt: string | null; cancelledReason: string | null;
  version: number; supersedesPeriodId: string | null;
};

export type LeaveBreakdownEntry = { code: string; label_fr: string; tenths: number; is_paid: boolean | null };

export type PayrollLine = {
  id: string; employeeId: string; employeeNumber: string;
  firstName: string; lastName: string; department: string;
  orgUnitLabel: string | null; positionLabel: string | null; workLocationLabel: string | null;
  contractKind: string | null; employmentStatus: string;
  hireDate: string | null; terminationDate: string | null;
  joinedInPeriod: boolean; leftInPeriod: boolean;
  hasOpenAssignment: boolean; hasLinkedAccount: boolean;
  attendanceDays: number; workedMinutes: number;
  leaveBreakdown: LeaveBreakdownEntry[]; leaveTenthsTotal: number;
  exceptions: string[];
};

export type PayrollAdjustmentKind = {
  id: string; code: string; labelFr: string; unit: string;
  requiresReason: boolean; isActive: boolean;
};

export type PayrollAdjustment = {
  id: string; periodId: string; employeeId: string; kindId: string;
  quantity: number; reason: string | null; status: string;
  proposedBy: string; decidedBy: string | null; decisionNote: string | null;
  version: number; supersedesAdjustmentId: string | null;
};

/** May this reader see per-person preparation content? The preparing desk or
 *  the parked read seat — never hr:sensitive:read (audit §9). */
export function canReadPayrollFacts(permissions: string[]): boolean {
  return permissions.includes("hr:manage") || permissions.includes("hr:payroll:read");
}

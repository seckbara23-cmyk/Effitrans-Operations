/**
 * Customs clearance state machine (Phase 1.9) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Forward flow with BLOCKED (pause/resume) and CANCELLED (abort). Not strictly
 * linear — after DECLARED, customs may review / inspect / assess in any order.
 * RELEASED and CANCELLED are terminal. Mirrors the task/file pattern (tested).
 */
import type { CustomsStatus } from "./types";

export const CUSTOMS_STATUSES: CustomsStatus[] = [
  "NOT_STARTED",
  "DOCUMENTS_PENDING",
  "DECLARATION_PREPARED",
  "DECLARED",
  "UNDER_REVIEW",
  "INSPECTION",
  "DUTIES_ASSESSED",
  "RELEASED",
  "BLOCKED",
  "CANCELLED",
];

const ALLOWED: Record<CustomsStatus, CustomsStatus[]> = {
  NOT_STARTED: ["DOCUMENTS_PENDING", "CANCELLED"],
  DOCUMENTS_PENDING: ["DECLARATION_PREPARED", "BLOCKED", "CANCELLED"],
  DECLARATION_PREPARED: ["DECLARED", "BLOCKED", "CANCELLED"],
  DECLARED: ["UNDER_REVIEW", "INSPECTION", "DUTIES_ASSESSED", "BLOCKED", "CANCELLED"],
  UNDER_REVIEW: ["INSPECTION", "DUTIES_ASSESSED", "BLOCKED", "CANCELLED"],
  INSPECTION: ["DUTIES_ASSESSED", "RELEASED", "BLOCKED", "CANCELLED"],
  DUTIES_ASSESSED: ["RELEASED", "BLOCKED", "CANCELLED"],
  BLOCKED: ["DOCUMENTS_PENDING", "DECLARED", "UNDER_REVIEW", "INSPECTION", "DUTIES_ASSESSED", "CANCELLED"],
  RELEASED: [],
  CANCELLED: [],
};

export function isCustomsStatus(v: string): v is CustomsStatus {
  return (CUSTOMS_STATUSES as string[]).includes(v);
}

export function nextStatuses(from: CustomsStatus): CustomsStatus[] {
  return ALLOWED[from] ?? [];
}

export function canTransition(from: CustomsStatus, to: CustomsStatus): boolean {
  return nextStatuses(from).includes(to);
}

export function isTerminal(status: CustomsStatus): boolean {
  return status === "RELEASED" || status === "CANCELLED";
}

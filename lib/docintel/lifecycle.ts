/**
 * Document Intelligence — job lifecycle (Phase 7.4A). PURE. Explicit, validated transitions.
 * Execution is SYNCHRONOUS + operator-triggered (no queue/worker exists — we do not simulate
 * one), so the happy path runs QUEUED → … → READY_FOR_REVIEW in a single triggered pass and
 * review/apply advance it afterward. FAILED / APPLIED / CANCELLED are terminal.
 */
import type { JobStatus } from "./types";

const ALLOWED: Record<JobStatus, JobStatus[]> = {
  QUEUED: ["CLASSIFYING", "FAILED", "CANCELLED"],
  CLASSIFYING: ["EXTRACTING_TEXT", "FAILED", "CANCELLED"],
  EXTRACTING_TEXT: ["EXTRACTING_FIELDS", "FAILED", "CANCELLED"],
  EXTRACTING_FIELDS: ["VALIDATING", "FAILED", "CANCELLED"],
  VALIDATING: ["READY_FOR_REVIEW", "FAILED", "CANCELLED"],
  READY_FOR_REVIEW: ["PARTIALLY_APPROVED", "APPROVED", "CANCELLED"],
  PARTIALLY_APPROVED: ["PARTIALLY_APPROVED", "APPROVED", "APPLIED", "CANCELLED"],
  APPROVED: ["APPLIED", "PARTIALLY_APPROVED", "CANCELLED"],
  APPLIED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isTerminalJob(s: JobStatus): boolean {
  return s === "APPLIED" || s === "FAILED" || s === "CANCELLED";
}
export function nextJobStatuses(from: JobStatus): JobStatus[] {
  return ALLOWED[from] ?? [];
}
export function canJobTransition(from: JobStatus, to: JobStatus): boolean {
  return nextJobStatuses(from).includes(to);
}

export type JobTransition = { ok: true } | { ok: false; reason: "invalid_transition" | "terminal" };
export function validateJobTransition(from: JobStatus, to: JobStatus): JobTransition {
  if (isTerminalJob(from)) return { ok: false, reason: "terminal" };
  if (!canJobTransition(from, to)) return { ok: false, reason: "invalid_transition" };
  return { ok: true };
}

const LABEL_FR: Record<JobStatus, string> = {
  QUEUED: "En file", CLASSIFYING: "Classification", EXTRACTING_TEXT: "Extraction du texte",
  EXTRACTING_FIELDS: "Extraction des champs", VALIDATING: "Validation", READY_FOR_REVIEW: "Prêt pour revue",
  PARTIALLY_APPROVED: "Partiellement approuvé", APPROVED: "Approuvé", APPLIED: "Appliqué", FAILED: "Échec", CANCELLED: "Annulé",
};
export function jobStatusLabel(s: JobStatus): string {
  return LABEL_FR[s] ?? s;
}

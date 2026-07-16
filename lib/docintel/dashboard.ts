/**
 * Document Intelligence — dashboard aggregate CONTRACTS (Phase 7.4A). PURE. No ROI claims.
 */
import type { JobStatus, DocClass, Confidence, ValidationStatus, ReviewDecision } from "./types";

export type JobAggRow = { status: JobStatus; documentClass: DocClass };
export type FieldAggRow = { confidence: Confidence; validationStatus: ValidationStatus; reviewDecision: ReviewDecision; reconciliationStatus?: string | null; applicationResult?: string | null; reviewerId?: string | null };

export type DocIntelDashboard = {
  queued: number;
  processing: number;
  readyForReview: number;
  failed: number;
  byClass: { documentClass: DocClass; count: number }[];
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  unresolvedConflicts: number;
  appliedFields: number;
  reviewers: number;
};

const PROCESSING: JobStatus[] = ["CLASSIFYING", "EXTRACTING_TEXT", "EXTRACTING_FIELDS", "VALIDATING"];

export function buildDocIntelDashboard(jobs: JobAggRow[], fields: FieldAggRow[]): DocIntelDashboard {
  const byClassMap = new Map<DocClass, number>();
  let queued = 0, processing = 0, readyForReview = 0, failed = 0;
  for (const j of jobs) {
    if (j.status === "QUEUED") queued++;
    else if (PROCESSING.includes(j.status)) processing++;
    else if (j.status === "READY_FOR_REVIEW" || j.status === "PARTIALLY_APPROVED") readyForReview++;
    else if (j.status === "FAILED") failed++;
    byClassMap.set(j.documentClass, (byClassMap.get(j.documentClass) ?? 0) + 1);
  }
  let high = 0, med = 0, low = 0, conflicts = 0, applied = 0;
  const reviewers = new Set<string>();
  for (const f of fields) {
    if (f.confidence === "HIGH") high++;
    else if (f.confidence === "MEDIUM") med++;
    else if (f.confidence === "LOW") low++;
    if ((f.validationStatus === "CONFLICT" || f.reconciliationStatus === "CONFLICT") && f.reviewDecision === "PENDING") conflicts++;
    if (f.applicationResult === "APPLIED") applied++;
    if (f.reviewerId) reviewers.add(f.reviewerId);
  }
  return {
    queued, processing, readyForReview, failed,
    byClass: [...byClassMap.entries()].map(([documentClass, count]) => ({ documentClass, count })).sort((a, b) => b.count - a.count),
    highConfidence: high, mediumConfidence: med, lowConfidence: low, unresolvedConflicts: conflicts, appliedFields: applied, reviewers: reviewers.size,
  };
}

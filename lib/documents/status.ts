/**
 * Document workflow state machine (Phase 1.8) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * UPLOADED -> PENDING_REVIEW -> APPROVED | REJECTED. EXPIRED is DERIVED (see
 * ./expiry) — never a stored transition in the MVP. Re-upload after REJECTED /
 * EXPIRED creates a new version row rather than mutating the old one, so those
 * are terminal here. Mirrors the task/file state-machine pattern (unit-tested).
 */
import type { DocumentStatus } from "./types";
import { isPendingReview } from "./doctrine";

export const DOCUMENT_STATUSES: DocumentStatus[] = [
  "UPLOADED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
];

const ALLOWED: Record<DocumentStatus, DocumentStatus[]> = {
  UPLOADED: ["PENDING_REVIEW", "APPROVED", "REJECTED"],
  PENDING_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function isDocumentStatus(v: string): v is DocumentStatus {
  return (DOCUMENT_STATUSES as string[]).includes(v);
}

export function canTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** A document awaiting a decision can be submitted (UPLOADED only). */
export function canSubmit(status: DocumentStatus): boolean {
  return status === "UPLOADED";
}

/**
 * Approve / reject act on a not-yet-decided document.
 *
 * NORMALIZED (2026-08-21). This compared the RAW string and accepted only
 * `UPLOADED` or `PENDING_REVIEW`, so a document carrying the CANONICAL
 * `UNDER_REVIEW` was invisible to it and « Vérifier » never rendered. That made
 * this one predicate the thing blocking canonical spellings anywhere in the
 * platform — the deposit module could not stop minting `PENDING_REVIEW` without
 * making its own proofs unreviewable.
 *
 * Strictly WIDENING: `UPLOADED` and `PENDING_REVIEW` keep working (the alias maps
 * the latter onto `UNDER_REVIEW`), and `UNDER_REVIEW` starts working. Nothing that
 * was reviewable becomes unreviewable.
 *
 * RECOGNITION, NOT AUTHORIZATION. This decides whether the control is OFFERED.
 * Authority lives entirely outside it and is untouched: `document:approve` (UI
 * `canApprove` and `assertPermission` in `runReview`), `mayVerifyDocument` (the
 * pinned verifier seat plus maker-checker), and the `review_document` RPC — which
 * already accepted `UNDER_REVIEW`, because it guards by blocklist rather than
 * allowlist. This predicate was hiding a button the server would have honoured.
 *
 * Takes `string`: callers hold a status read from a row, and the legacy
 * `DocumentStatus` union cannot even represent `UNDER_REVIEW`.
 */
export function canReview(status: string): boolean {
  // Delegates to the doctrine so the review affordance and the "pending"
  // counters can never disagree about what awaiting-a-decision means.
  return isPendingReview(status);
}

/**
 * Document Intelligence — confidence normalization (Phase 7.4A). PURE.
 * Provider confidence values are NOT comparable across vendors, so we normalize to an
 * internal class. The raw score is preserved separately (never invented). Low-confidence data
 * is never presented as confirmed — the UI shows the class + validation + evidence.
 */
import type { Confidence } from "./types";

/** Normalize a 0..1 provider score into the internal class. A missing score → UNKNOWN. */
export function normalizeConfidence(score: number | null | undefined): Confidence {
  if (score == null || !Number.isFinite(score)) return "UNKNOWN";
  if (score >= 0.9) return "HIGH";
  if (score >= 0.7) return "MEDIUM";
  return "LOW";
}

/** Only HIGH-confidence, VALID, non-conflicting fields are eligible for batch approval. */
export function isBatchApprovable(input: { confidence: Confidence; validationStatus: string; reconciliationStatus?: string | null }): boolean {
  return input.confidence === "HIGH" && input.validationStatus === "VALID" && (input.reconciliationStatus == null || input.reconciliationStatus === "AGREEMENT" || input.reconciliationStatus === "NONE");
}

const LABEL_FR: Record<Confidence, string> = { HIGH: "Élevée", MEDIUM: "Moyenne", LOW: "Faible", UNKNOWN: "Inconnue" };
export function confidenceLabel(c: Confidence): string {
  return LABEL_FR[c];
}

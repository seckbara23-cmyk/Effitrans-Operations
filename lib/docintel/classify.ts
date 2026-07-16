/**
 * Document Intelligence — provider-neutral classification (Phase 7.4A). PURE.
 * The operator-declared class stays visible and authoritative for display. A provider
 * prediction that DISAGREES raises a review warning + requires confirmation — it never
 * silently changes the class. Low confidence never sets the class. Unknown stays UNKNOWN.
 */
import type { DocClass, Confidence } from "./types";

export type ClassificationInput = { declaredClass?: DocClass | null; predictedClass?: DocClass | null; predictedConfidence?: Confidence | null };
export type ClassificationResult = {
  finalClass: DocClass;
  confidence: Confidence;
  requiresConfirmation: boolean;
  conflict: boolean;
  declaredClass: DocClass | null;
  predictedClass: DocClass | null;
  reasons: string[];
};

export function classifyDocument(input: ClassificationInput): ClassificationResult {
  const declared = input.declaredClass ?? null;
  const predicted = input.predictedClass ?? null;
  const pconf = input.predictedConfidence ?? "UNKNOWN";
  const reasons: string[] = [];

  if (declared && predicted && predicted !== "UNKNOWN" && declared !== predicted) {
    reasons.push("declared_vs_predicted_conflict");
    return { finalClass: declared, confidence: "UNKNOWN", requiresConfirmation: true, conflict: true, declaredClass: declared, predictedClass: predicted, reasons };
  }
  if (declared) {
    reasons.push(predicted === declared ? "declared_confirmed_by_prediction" : "operator_declared");
    return { finalClass: declared, confidence: predicted === declared ? pconf : "HIGH", requiresConfirmation: false, conflict: false, declaredClass: declared, predictedClass: predicted, reasons };
  }
  if (predicted && predicted !== "UNKNOWN" && pconf === "HIGH") {
    reasons.push("predicted_high_confidence");
    return { finalClass: predicted, confidence: "HIGH", requiresConfirmation: true, conflict: false, declaredClass: null, predictedClass: predicted, reasons };
  }
  // Low/absent prediction with no operator declaration → never guessed.
  reasons.push("unknown_not_guessed");
  return { finalClass: "UNKNOWN", confidence: predicted ? pconf : "UNKNOWN", requiresConfirmation: true, conflict: false, declaredClass: null, predictedClass: predicted, reasons };
}

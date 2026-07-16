/**
 * Executive Copilot — shared types (Phase 7.7). PURE.
 * ---------------------------------------------------------------------------
 * The THIRD sibling of the Copilot card contract (internal Logistics 7.6A/B · customer Portal 7.6C
 * · executive 7.7). Same guarantee: structure is DETERMINISTIC (computed from the executive
 * snapshot, which is itself composed from the authoritative module readers) and never emitted by
 * the model.
 *
 * The executive context is NOT a new read: it is the ALREADY-COMPOSED ExecutiveIntelligence
 * snapshot (request-cached), so asking the copilot a question costs no additional query.
 */
import type { ExecutiveAlertLevel, ExecutiveSection } from "../types";

export const EXEC_CARD_KINDS = [
  "REVENUE_RISK",
  "OPERATIONAL_BOTTLENECK",
  "CUSTOMS_CONGESTION",
  "LATE_DELIVERIES",
  "HIGH_RISK_CUSTOMERS",
  "DOCUMENT_BACKLOG",
  "CASH_COLLECTION_RISK",
  "CAPACITY_WARNING",
  "GROWING_DELAYS",
  "PROVIDER_AVAILABILITY",
] as const;
export type ExecCardKind = (typeof EXEC_CARD_KINDS)[number];

export type ExecConfidence = "HIGH" | "MEDIUM" | "LOW";

/** One cited executive fact. `href` drills into the workspace that OWNS the number. */
export type ExecEvidence = {
  label: string;
  value: string | null;
  detail?: string | null;
  href?: string | null;
  section?: ExecutiveSection;
};

export type ExecRecommendationCard = {
  kind: ExecCardKind;
  title: string;
  finding: string;
  evidence: ExecEvidence[];
  confidence: ExecConfidence;
  reasoning: string;
  suggestedAction: string;
  sections: ExecutiveSection[];
  timestamp: string;
};

export type ExecQuestionClass =
  | "revenue" | "operations" | "customs" | "delays" | "customers" | "documents" | "ai" | "summary" | "general";

export const EXEC_CARD_TITLE: Record<ExecCardKind, string> = {
  REVENUE_RISK: "Risque sur le revenu",
  OPERATIONAL_BOTTLENECK: "Goulot d'étranglement opérationnel",
  CUSTOMS_CONGESTION: "Congestion douanière",
  LATE_DELIVERIES: "Livraisons en retard",
  HIGH_RISK_CUSTOMERS: "Clients à risque",
  DOCUMENT_BACKLOG: "Arriéré documentaire",
  CASH_COLLECTION_RISK: "Risque de recouvrement",
  CAPACITY_WARNING: "Alerte de capacité",
  // The brief called this "Growing Delays", but no period-over-period history is kept, so a title
  // asserting growth would claim a trend the data cannot support. The kind keeps the brief's name;
  // the LABEL states what is actually measured — a level, not a direction.
  GROWING_DELAYS: "Délais opérationnels mesurés",
  PROVIDER_AVAILABILITY: "Disponibilité du fournisseur IA",
};

export type ExecAlertSummary = Record<ExecutiveAlertLevel, number>;

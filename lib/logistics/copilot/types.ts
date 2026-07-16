/**
 * Logistics Copilot — shared types (Phase 7.6A + 7.6B operational depth). PURE.
 * ---------------------------------------------------------------------------
 * The recommendation-card contract and the bounded, read-only context shape. Structure is
 * DETERMINISTIC (computed from real rows), never emitted by the model — no hallucinated facts.
 * Every card cites finding / evidence (records with real identifiers) / confidence / reasoning /
 * suggested action / source modules / timestamp. 7.6B adds richer evidence fields, portfolio risk,
 * missing-required documents, a safe Document-Intelligence projection, grounded customer-notification
 * facts, deterministic context budgeting, and safe usage visibility.
 */

export const LOGISTICS_MODULES = ["road", "ocean", "air", "customs", "documents", "finance"] as const;
export type LogisticsModule = (typeof LOGISTICS_MODULES)[number];

export const CARD_KINDS = [
  "BLOCKED_CUSTOMS", "DELAYED_VESSEL", "LATE_FLIGHT", "MISSING_DOCUMENT", "UPCOMING_ETA",
  "CUSTOMER_NOTIFICATION", "OVERDUE_INVOICE", "RISK_SHIPMENT", "COMPLIANCE_WARNING",
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

/** One cited record. `reference` is a human identifier (file / declaration / invoice number).
 *  7.6B evidence-panel fields (all optional, all SAFE — no internal ids, PII, or document bodies). */
export type EvidenceRecord = {
  label: string;
  reference: string | null;
  detail?: string | null;
  link?: string | null;
  module?: LogisticsModule;
  status?: string | null;
  timestamp?: string | null;
  freshness?: string | null;
  confidence?: Confidence;
};

export type RecommendationCard = {
  kind: CardKind;
  title: string;
  finding: string;
  evidence: EvidenceRecord[];
  confidence: Confidence;
  reasoning: string;
  suggestedAction: string;
  sourceModules: LogisticsModule[];
  timestamp: string;
};

// ---- context (plain data assembled by the async builder; the card engine is pure over it) ----
export type CopilotAlert = { mode: string; severity: string; reference: string | null; clientName: string | null; reason: string; link: string };
export type CopilotUpcoming = { mode: string; reference: string | null; clientName: string | null; route: string; at: string; status: string; link: string };
export type CopilotDeclaration = { reference: string | null; fileNumber: string | null; clientName: string | null; office: string | null; status: string; link: string };
export type CopilotInvoice = { invoiceNumber: string | null; fileNumber: string | null; clientName: string | null; balance: number; currency: string; dueDate: string | null; daysOverdue: number; paymentState: string; link: string };
export type LogisticsHeadline = { movementsInProgress: number; arrivingWithin7Days: number; overdueOps: number; criticalAlerts: number; awaitingCustoms: number; exceptions: number };

/** Required-document requirement state (7.6B) — distinct from the OCR review queue. */
export type RequirementState = "MISSING" | "EXPIRED" | "AWAITING_REVIEW" | "EXTRACTION_FAILED" | "CONFLICT" | "UNKNOWN";
export type CopilotMissingDoc = { fileNumber: string | null; fileId: string; documentType: string; state: RequirementState; due: string | null; link: string };

/** Safe Document-Intelligence projection (7.6B) — states/counts only, NEVER values/text. */
export type CopilotDocIntelJob = { fileNumber: string | null; documentId: string; declaredType: string | null; predictedType: string | null; state: string; ocrRequired: boolean; failureCategory: string | null; conflictCount: number; candidateCount: number; link: string };

/** A file surfaced by the bounded portfolio-risk projection (reuses assessRisk). */
export type CopilotRiskRow = { fileNumber: string | null; fileId: string; level: string; score: number; contributors: string[]; modes: LogisticsModule[]; ageDays: number | null; latestEvent: string | null; link: string; hasUnknown: boolean };

/** A grounded customer-notification opportunity (7.6B) — recommendation only, no contact values. */
export type CopilotNotifyOpportunity = { mode: string; reference: string | null; clientName: string | null; reason: string; alreadyNotified: boolean; link: string };

export type QuestionClass = "attention" | "customs" | "transport" | "documents" | "finance" | "risk" | "customer" | "general";

export type LogisticsContext = {
  generatedAt: string;
  questionClass: QuestionClass;
  modules: LogisticsModule[];
  unavailable: LogisticsModule[];
  authorized: { transport: boolean; customs: boolean; finance: boolean; document: boolean };
  headline: LogisticsHeadline | null;
  attention: CopilotAlert[];
  upcoming: CopilotUpcoming[];
  blockedCustoms: CopilotDeclaration[];
  overdueInvoices: CopilotInvoice[];
  missingDocs: CopilotMissingDoc[];
  docIntelJobs: CopilotDocIntelJob[];
  portfolioRisk: CopilotRiskRow[];
  notifyOpportunities: CopilotNotifyOpportunity[];
  docReview: { readyForReview: number; failed: number } | null;
  /** deterministic budgeting — which modules were capped, and the disclosed caps. */
  truncated: LogisticsModule[];
  counts: { attention: number; upcoming: number; blockedCustoms: number; overdueInvoices: number; missingDocs: number; docIntelJobs: number; portfolioRisk: number; cap: number };
};

export const CARD_TITLE: Record<CardKind, string> = {
  BLOCKED_CUSTOMS: "Douane bloquée",
  DELAYED_VESSEL: "Navire en retard",
  LATE_FLIGHT: "Vol en retard",
  MISSING_DOCUMENT: "Documents obligatoires manquants",
  UPCOMING_ETA: "Arrivées imminentes",
  CUSTOMER_NOTIFICATION: "Notification client suggérée",
  OVERDUE_INVOICE: "Factures en souffrance",
  RISK_SHIPMENT: "Dossiers à risque élevé",
  COMPLIANCE_WARNING: "Alerte conformité",
};

// ---- usage visibility (7.6B) — SAFE aggregates only ----
export type CopilotUsageSummary = {
  windowDays: number;
  total: number;
  answered: number;
  fallback: number;
  failed: number;
  exports: number;
  avgDurationMs: number | null;
  tokens: { prompt: number; completion: number; total: number } | null;
  providers: string[];
  models: string[];
};

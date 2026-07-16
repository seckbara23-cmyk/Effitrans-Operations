/**
 * Logistics Copilot — shared types (Phase 7.6A). PURE (no I/O, no server imports).
 * ---------------------------------------------------------------------------
 * The recommendation-card contract and the bounded, read-only context shape. Structure is
 * DETERMINISTIC (computed from real rows), never emitted by the model — so there are no
 * hallucinated facts. Every card cites its finding, evidence (records with real identifiers),
 * confidence, reasoning, suggested action, source modules, and a timestamp.
 */

export const LOGISTICS_MODULES = ["road", "ocean", "air", "customs", "documents", "finance"] as const;
export type LogisticsModule = (typeof LOGISTICS_MODULES)[number];

export const CARD_KINDS = [
  "BLOCKED_CUSTOMS", "DELAYED_VESSEL", "LATE_FLIGHT", "MISSING_DOCUMENT", "UPCOMING_ETA",
  "CUSTOMER_NOTIFICATION", "OVERDUE_INVOICE", "RISK_SHIPMENT", "COMPLIANCE_WARNING",
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

/** One cited record. `reference` is a human identifier (file / declaration / invoice number). */
export type EvidenceRecord = { label: string; reference: string | null; detail?: string | null; link?: string | null };

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
export type CopilotInvoice = { invoiceNumber: string | null; fileNumber: string | null; clientName: string | null; balance: number; currency: string; dueDate: string | null; link: string };
export type LogisticsHeadline = { movementsInProgress: number; arrivingWithin7Days: number; overdueOps: number; criticalAlerts: number; awaitingCustoms: number; exceptions: number };

export type LogisticsContext = {
  generatedAt: string;
  /** modules actually consulted (authorized + read succeeded). */
  modules: LogisticsModule[];
  /** modules NOT consulted (unauthorized or read failed) — so the copilot says "not available"
   *  rather than "nothing found" (Missing ≠ Negative). */
  unavailable: LogisticsModule[];
  authorized: { transport: boolean; customs: boolean; finance: boolean; document: boolean };
  headline: LogisticsHeadline | null;
  attention: CopilotAlert[];
  upcoming: CopilotUpcoming[];
  blockedCustoms: CopilotDeclaration[];
  overdueInvoices: CopilotInvoice[];
  docReview: { readyForReview: number; failed: number } | null;
  /** disclosed sizes (each source is page-0, ≤ CAP; never a full-tenant scan). */
  counts: { attention: number; upcoming: number; blockedCustoms: number; overdueInvoices: number; cap: number };
};

export const CARD_TITLE: Record<CardKind, string> = {
  BLOCKED_CUSTOMS: "Douane bloquée",
  DELAYED_VESSEL: "Navire en retard",
  LATE_FLIGHT: "Vol en retard",
  MISSING_DOCUMENT: "Documents à traiter",
  UPCOMING_ETA: "Arrivées imminentes",
  CUSTOMER_NOTIFICATION: "Notification client suggérée",
  OVERDUE_INVOICE: "Factures en souffrance",
  RISK_SHIPMENT: "Expéditions à risque",
  COMPLIANCE_WARNING: "Alerte conformité",
};

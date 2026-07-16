/**
 * Customer AI Assistant — shared types (Phase 7.6C). PURE.
 * ---------------------------------------------------------------------------
 * The CUSTOMER-FACING sibling of the Logistics Copilot card contract
 * (lib/logistics/copilot/types.ts). Same shape of guarantee — structure is DETERMINISTIC
 * (computed from real owned rows), never emitted by the model — but a deliberately NARROWER
 * surface: this context may only ever carry what the authenticated portal user can already see
 * on their own pages.
 *
 * DELIBERATE DIVERGENCES from the internal card model (not omissions):
 *  - NO `confidence` on a card. Internal cards rank themselves for operators; a customer must
 *    never be shown a confidence/risk score (7.6C security rule).
 *  - NO `sourceModules` naming internal modules (road/ocean/air/customs/documents/finance) —
 *    customer-facing SECTIONS instead, named for what the customer sees in their portal.
 *  - NO internal ids: `reference` is always a customer-visible identifier (file number, BL/AWB,
 *    container/ULD, invoice number) and `link` is always a /portal/* URL.
 */
import type { EtaBasis } from "../eta";
import type { PortalStageKey } from "../progress-map";
import type { DelayState } from "../tracking-derive";
import type { DocReqState } from "../tracking-derive";

/** Customer-facing context sections — what the customer sees, never an internal module name. */
export const PORTAL_SECTIONS = ["shipment", "transport", "customs", "documents", "invoices", "notifications", "contact"] as const;
export type PortalSection = (typeof PORTAL_SECTIONS)[number];

/** Customer-safe card kinds. There is NO internal-only card (no risk, no compliance, no SLA). */
export const PORTAL_CARD_KINDS = [
  "SHIPMENT_PROGRESS",
  "MISSING_DOCUMENTS",
  "UPCOMING_ARRIVAL",
  "AWAITING_CUSTOMER_ACTION",
  "INVOICE_AVAILABLE",
  "CUSTOMS_PROCESSING",
  "DOCUMENT_REVIEW",
  "NOTIFICATION_AVAILABLE",
] as const;
export type PortalCardKind = (typeof PORTAL_CARD_KINDS)[number];

/** One cited, customer-visible record. `reference` is an identifier the customer already knows. */
export type PortalEvidenceRecord = {
  label: string;
  reference: string | null;
  detail?: string | null;
  /** always a /portal/* link — the customer can open exactly what was cited */
  link?: string | null;
  section?: PortalSection;
  status?: string | null;
  timestamp?: string | null;
};

/** A deterministic customer recommendation. No confidence, no score, no internal reasoning. */
export type PortalRecommendationCard = {
  kind: PortalCardKind;
  title: string;
  finding: string;
  evidence: PortalEvidenceRecord[];
  /** plain-language justification grounded in the evidence — never internal reasoning */
  reasoning: string;
  suggestedAction: string;
  sections: PortalSection[];
  timestamp: string;
};

/** Allowlisted customer question classes (the model never chooses what is read). */
export type PortalQuestionClass =
  | "location"
  | "delay"
  | "eta"
  | "documents"
  | "customs"
  | "invoices"
  | "contact"
  | "summary"
  | "action"
  | "general";

// ---------------------------------------------------------------- context pieces ----

/** Customer-safe ETA. Carries the BASIS (how it is grounded) — never a confidence score. */
export type PortalCopilotEta = {
  estimatedDate: string | null;
  basis: EtaBasis;
  delayDays: number;
  delivered: boolean;
};

/** Customer-safe customs view, derived from the CUSTOMER timeline — never the internal
 *  customs_record status (no rejection/inspection/blocking reasoning). */
export type PortalCopilotCustoms = {
  state: "not_started" | "in_progress" | "cleared";
  label: string;
};

/** Customer-safe map projection summary — presence + last located point, never coordinates
 *  reasoning, provider source, or tracking confidence. */
export type PortalCopilotMap = {
  hasGeo: boolean;
  positionLabel: string | null;
  positionAt: string | null;
  positionFreshness: string | null;
  milestoneCount: number;
};

/** Vessel / flight carriage (the customer already sees this on the dossier page). */
export type PortalCopilotCarriage = {
  mode: "SEA" | "AIR";
  transportLabel: string;
  carrierOrVessel: string | null;
  voyageOrFlight: string | null;
  milestoneLabel: string | null;
  references: { label: string; value: string }[];
  units: { heading: string; items: { label: string; type: string | null; status: string }[] };
  map: PortalCopilotMap;
};

/** The focused shipment (dossier-scoped question). */
export type PortalCopilotShipment = {
  fileNumber: string;
  type: string;
  route: string;
  currentStage: PortalStageKey | null;
  currentLocation: string;
  currentDepartment: string;
  progressPercent: number;
  delay: { state: DelayState; label: string; explanation: string | null };
  eta: PortalCopilotEta;
  nextStep: { title: string; explanation: string; clientAction: string | null; party: string };
  transportStatusLabel: string | null;
  lastActivityAt: string | null;
  podAvailable: boolean;
  link: string;
};

/** One of the customer's other shipments (portfolio-scoped question). */
export type PortalCopilotShipmentBrief = {
  fileNumber: string;
  reference: string | null;
  route: string;
  status: string;
  percent: number;
  eta: string | null;
  delayLabel: string;
  nextStepTitle: string;
  link: string;
};

export type PortalCopilotDocRequirement = { label: string; state: DocReqState };
export type PortalCopilotDocument = { typeLabel: string; status: string; createdAt: string; link: string };
export type PortalCopilotInvoice = {
  invoiceNumber: string | null;
  status: string;
  currency: string;
  total: number;
  balance: number;
  dueDate: string | null;
  overdue: boolean;
  link: string;
};
export type PortalCopilotNotification = { title: string; category: string; createdAt: string; read: boolean };
export type PortalCopilotActivity = { title: string; date: string };

/** The assigned account manager (or the operations-team fallback) — the ONLY staff identity a
 *  customer may ever see, exactly as the dossier page already shows it. */
export type PortalCopilotContact = {
  name: string;
  title: string;
  isTeam: boolean;
  businessEmail: string | null;
  businessPhone: string | null;
};

/** The bounded, read-only, customer-scoped snapshot. Everything here is already visible to the
 *  authenticated portal user on their own pages. */
export type PortalCopilotContext = {
  generatedAt: string;
  questionClass: PortalQuestionClass;
  /** "shipment" = one owned dossier in focus; "portfolio" = the customer's own shipments. */
  scope: "shipment" | "portfolio";
  clientName: string | null;
  /** sections actually consulted */
  sections: PortalSection[];
  /** sections NOT included (absent/failed) — missing ≠ "nothing to report" */
  unavailable: PortalSection[];
  /** sections whose records were capped (disclosed, never silent) */
  truncated: PortalSection[];
  shipment: PortalCopilotShipment | null;
  carriage: PortalCopilotCarriage | null;
  customs: PortalCopilotCustoms | null;
  portfolio: PortalCopilotShipmentBrief[];
  requirements: PortalCopilotDocRequirement[];
  documents: PortalCopilotDocument[];
  invoices: PortalCopilotInvoice[];
  notifications: PortalCopilotNotification[];
  activity: PortalCopilotActivity[];
  contact: PortalCopilotContact | null;
  counts: {
    portfolio: number;
    requirements: number;
    documents: number;
    invoices: number;
    notifications: number;
    activity: number;
  };
};

export const PORTAL_CARD_TITLE: Record<PortalCardKind, string> = {
  SHIPMENT_PROGRESS: "Avancement de votre expédition",
  MISSING_DOCUMENTS: "Documents manquants",
  UPCOMING_ARRIVAL: "Arrivée prochaine",
  AWAITING_CUSTOMER_ACTION: "Action attendue de votre part",
  INVOICE_AVAILABLE: "Facture disponible",
  CUSTOMS_PROCESSING: "Dédouanement en cours",
  DOCUMENT_REVIEW: "Documents en cours de vérification",
  NOTIFICATION_AVAILABLE: "Nouvelles informations",
};

export const PORTAL_SECTION_LABEL: Record<PortalSection, string> = {
  shipment: "Expédition",
  transport: "Transport",
  customs: "Douane",
  documents: "Documents",
  invoices: "Factures",
  notifications: "Notifications",
  contact: "Contact",
};

/**
 * Premium portal view helpers (Phase 3.3) — PURE, client + server safe. No I/O.
 * ---------------------------------------------------------------------------
 * Presentation-only derivations for the premium client experience. Every value
 * is derived from data the existing services already return — no new business
 * logic, no lifecycle/SLA/risk recalculation (the Risk Engine + lifecycle engine
 * produce the raw inputs; these functions only MAP them to customer-safe views).
 */
import type { RiskLevel } from "@/lib/copilot/risk-engine";
import type { PortalStageKey, PortalStageStatus } from "./progress-map";

// ------------------------------------------------------------------- risk view
/** Customer-facing shipment health — a coarse, reassuring indicator. */
export type PortalRiskLevel = "on_track" | "attention" | "delayed";

/** Map the internal Risk Engine level to a customer-safe indicator. */
export function toPortalRisk(level: RiskLevel): PortalRiskLevel {
  if (level === "critical" || level === "high") return "delayed";
  if (level === "medium") return "attention";
  return "on_track";
}

// The canonical ETA engine now lives in ./eta (Phase 3.3A, Deliverable 8).
const DAY = 86_400_000;

// ---------------------------------------------------------------- availability
export type Availability = "online" | "recent" | "offline";

/** Officer availability from last_seen_at (presence). Placeholder-friendly. */
export function classifyAvailability(lastSeenAt: string | null, now: Date): Availability {
  if (!lastSeenAt) return "offline";
  const ms = now.getTime() - new Date(lastSeenAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "online";
  if (ms < 5 * 60_000) return "online";
  if (ms < DAY) return "recent"; // seen within the last 24 h
  return "offline";
}

// ------------------------------------------------------------- document groups
export type DocCategory = "commercial" | "transport" | "customs" | "finance";
export const DOC_CATEGORY_ORDER: DocCategory[] = ["commercial", "transport", "customs", "finance"];

/** Bucket a document type code into a customer-facing category (keyword rules). */
export function documentCategory(typeCode: string): DocCategory {
  const c = typeCode.toUpperCase();
  if (/CUSTOM|DOUANE|DECLARATION|BAE|DDU|DDP/.test(c)) return "customs";
  if (/INVOICE|FACTURE|PAYMENT|FINANC|RECEIPT|QUOTE|DEVIS/.test(c)) return "finance";
  if (/BL|B_L|LADING|CONNAISSEMENT|AWB|LTA|WAYBILL|DELIVERY|POD|TRANSPORT|BOOKING|MANIFEST|CONTAINER/.test(c)) return "transport";
  return "commercial";
}

export type CategorizedDoc = { category: DocCategory };

/** Group documents by category, preserving input order within each group. */
export function groupDocuments<T extends { typeCode: string }>(docs: T[]): Record<DocCategory, T[]> {
  const out: Record<DocCategory, T[]> = { commercial: [], transport: [], customs: [], finance: [] };
  for (const d of docs) out[documentCategory(d.typeCode)].push(d);
  return out;
}

// ------------------------------------------------------------------ date utils
const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** "14/06/2026" (UTC, locale-independent). */
export function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** "14 juin" for timeline entries (UTC, locale-independent). */
export function formatDayMonth(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS_FR[d.getUTCMonth()]}`;
}

// --------------------------------------------------------------- major phases
/** The 4 headline milestones for the horizontal tracker (a view over the 10 stages). */
export type MajorPhaseKey = "documentation" | "customs" | "transport" | "delivery";
export const MAJOR_PHASE_ORDER: MajorPhaseKey[] = ["documentation", "customs", "transport", "delivery"];

const MAJOR_PHASE_STAGES: Record<MajorPhaseKey, PortalStageKey[]> = {
  documentation: ["documents_received", "documents_verified"],
  customs: ["customs_in_progress", "customs_done"],
  transport: ["transport_planned", "in_transit"],
  delivery: ["delivered"],
};

/**
 * Collapse the 10-stage customer timeline into 4 headline phases for the
 * horizontal tracker. Pure view over the existing timeline — no re-calculation.
 */
export function toMajorPhases(
  stages: { key: PortalStageKey; status: PortalStageStatus }[],
): { key: MajorPhaseKey; status: PortalStageStatus }[] {
  const byKey = new Map(stages.map((s) => [s.key, s.status] as const));
  return MAJOR_PHASE_ORDER.map((key) => {
    const sub = MAJOR_PHASE_STAGES[key].map((k) => byKey.get(k) ?? "pending");
    let status: PortalStageStatus;
    if (sub.every((s) => s === "completed")) status = "completed";
    else if (sub.some((s) => s === "current" || s === "completed")) status = "current";
    else status = "pending";
    return { key, status };
  });
}

// ------------------------------------------------------------------ map phases
export type MapPhase = "port" | "customs" | "warehouse" | "transport" | "client";

/**
 * Map the customer stage to a position on the static logistics map. The map
 * component renders these fixed nodes; a later Leaflet/GPS swap only changes the
 * renderer, not this mapping.
 */
export function stageToMapPhase(stage: PortalStageKey | null): MapPhase {
  switch (stage) {
    case null:
    case "created":
    case "documents_received":
    case "documents_verified":
      return "port";
    case "customs_in_progress":
    case "customs_done":
      return "customs";
    case "transport_planned":
      return "warehouse";
    case "in_transit":
      return "transport";
    default:
      return "client"; // delivered / invoiced / paid
  }
}

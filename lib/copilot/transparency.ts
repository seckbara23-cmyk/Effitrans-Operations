/**
 * Copilot answer transparency (Phase AI-2a) — PURE, deterministic. No I/O.
 * ---------------------------------------------------------------------------
 * D10/D11: every Copilot answer carries a transparency footer that is computed
 * DETERMINISTICALLY from the context + detected skill — NOT self-reported by the
 * model (a small local model would fabricate certainty). It lists:
 *   - sources : the dossier SECTIONS the answer can legitimately draw on (cited
 *               by section name, never raw DB fields — D11),
 *   - restricted : sections hidden from THIS user by permission (D13 boundary),
 *   - unknown : notable facts that are genuinely absent (so "unknown" ≠ "hidden"),
 *   - confidence : high | medium | low, from whether the SKILL's primary section
 *               is present and populated.
 * Unit-tested. Contains no secrets and never inspects hidden-section data.
 */
import type { CopilotContext } from "@/lib/copilot/context";
import type { CopilotSkill } from "@/lib/copilot/skills";

export type Confidence = "high" | "medium" | "low";

export type CopilotTransparency = {
  sources: string[];
  restricted: string[];
  unknown: string[];
  confidence: Confidence;
};

/** Section labels (French) — the citation vocabulary shown to the user. */
const LABEL = {
  dossier: "Dossier",
  lifecycle: "Cycle de vie",
  risk: "Risque",
  documents: "Documents",
  customs: "Douane",
  transport: "Transport",
  tracking: "Suivi",
  finance: "Finance",
  sla: "SLA",
  tasks: "Tâches",
} as const;

/** Section presence flags used for sources / confidence. */
type Presence = {
  documents: boolean;
  customs: boolean;
  transport: boolean;
  tracking: boolean;
  finance: boolean;
  sla: boolean;
  tasks: boolean;
};

function presence(ctx: CopilotContext): Presence {
  return {
    documents: ctx.documents.included,
    customs: ctx.customs.included && ctx.customs.data.present,
    transport: ctx.transport.included && ctx.transport.data.present,
    tracking: ctx.tracking.included && ctx.tracking.data.present,
    finance: ctx.finance.included,
    sla: ctx.sla.included,
    tasks: ctx.tasks.included,
  };
}

/** Sections the caller cannot read (permission-restricted), by label. */
function restrictedSections(ctx: CopilotContext): string[] {
  const out: string[] = [];
  if (!ctx.documents.included) out.push(LABEL.documents);
  if (!ctx.customs.included) out.push(LABEL.customs);
  if (!ctx.transport.included) out.push(LABEL.transport);
  if (!ctx.tracking.included) out.push(LABEL.tracking);
  if (!ctx.finance.included) out.push(LABEL.finance);
  if (!ctx.tasks.included) out.push(LABEL.tasks);
  return out;
}

/** Notable facts that are genuinely ABSENT (unknown ≠ hidden). Capped + ordered. */
function unknownFacts(ctx: CopilotContext): string[] {
  const out: string[] = [];
  if (ctx.transport.included && ctx.transport.data.present && !ctx.transport.data.deliveryPlanned) {
    out.push("Livraison non planifiée");
  }
  if (ctx.tracking.included && ctx.tracking.data.present) {
    if (!ctx.tracking.data.eta.estimatedArrival) out.push("ETA indisponible");
    if (!ctx.tracking.data.latestPositionAt) out.push("Position de suivi indisponible");
  }
  if (ctx.transport.included && ctx.transport.data.present && !ctx.transport.data.driverName) {
    out.push("Chauffeur non assigné");
  }
  return out.slice(0, 4);
}

/** The SECTIONS an answer can draw on — always the core three, plus present ones. */
function sourceSections(ctx: CopilotContext): string[] {
  const p = presence(ctx);
  const out: string[] = [LABEL.dossier, LABEL.lifecycle, LABEL.risk];
  if (p.documents) out.push(LABEL.documents);
  if (p.customs) out.push(LABEL.customs);
  if (p.transport) out.push(LABEL.transport);
  if (p.tracking) out.push(LABEL.tracking);
  if (p.finance) out.push(LABEL.finance);
  if (p.sla) out.push(LABEL.sla);
  if (p.tasks) out.push(LABEL.tasks);
  return out;
}

/** Confidence from the SKILL's primary section: restricted→low, present→high, empty→medium. */
function skillConfidence(ctx: CopilotContext, skill: CopilotSkill): Confidence {
  const p = presence(ctx);
  const restrictedCount = restrictedSections(ctx).length;

  switch (skill) {
    case "missing_documents":
      return !ctx.documents.included ? "low" : "high";
    case "customs_status":
      return !ctx.customs.included ? "low" : p.customs ? "high" : "medium";
    case "tracking_status":
    case "delay_analysis":
    case "timeline_summary":
      return !ctx.tracking.included ? "low" : p.tracking ? "high" : "medium";
    case "risk_summary":
    case "next_step":
      // Lifecycle + risk are always present; only soften if lots is hidden.
      return restrictedCount >= 3 ? "medium" : "high";
    case "client_update":
    case "internal_handover":
    case "shipment_summary":
    case "general":
    default:
      return restrictedCount === 0 ? "high" : restrictedCount >= 3 ? "low" : "medium";
  }
}

/** Compute the deterministic transparency footer for an answer. */
export function buildTransparency(ctx: CopilotContext, skill: CopilotSkill): CopilotTransparency {
  return {
    sources: sourceSections(ctx),
    restricted: restrictedSections(ctx),
    unknown: unknownFacts(ctx),
    confidence: skillConfidence(ctx, skill),
  };
}

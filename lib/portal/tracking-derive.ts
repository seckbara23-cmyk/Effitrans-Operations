/**
 * Customer-safe tracking derivations (Phase 3.3A) — PURE, unit-tested. No I/O.
 * ---------------------------------------------------------------------------
 * Turns the raw (owned) dossier signals into customer-safe views: route with
 * fallbacks, a 4-level delay label + plain explanation, the next step, document
 * requirement states, and a deduplicated activity timeline. Never leaks internal
 * risk scores, SLA thresholds, staff identities, task names or audit payloads.
 */
import type { RiskLevel } from "@/lib/copilot/risk-engine";
import type { PortalStageKey } from "./progress-map";

// ---------------------------------------------------------- department label
const DEPARTMENT_LABEL: Record<string, string> = {
  opening: "Ouverture du dossier",
  documentation: "Documentation",
  customs: "Douane",
  transport: "Transport",
  finance: "Finance",
  archive: "Archivé",
};

/** Customer-safe department name (never an internal code). */
export function departmentLabel(dep: string | null): string {
  return (dep && DEPARTMENT_LABEL[dep]) || "Traitement en cours";
}

// ---------------------------------------------------------------- route (D2)
export type PortalRoute = { origin: string; destination: string; display: string; confirmed: boolean };

function firstText(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const s = (v ?? "").trim();
    if (s) return s;
  }
  return null;
}

/** Best available route, never "— → —". Priority: shipment fields → transport locations → fallbacks. */
export function resolveRoute(input: {
  shipmentOrigin: string | null;
  shipmentDestination: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
}): PortalRoute {
  const origin = firstText(input.shipmentOrigin, input.pickupLocation);
  const destination = firstText(input.shipmentDestination, input.deliveryLocation);

  if (origin && destination) return { origin, destination, display: `${origin} → ${destination}`, confirmed: true };
  if (origin && !destination) return { origin, destination: "Destination à confirmer", display: `${origin} → Destination à confirmer`, confirmed: false };
  if (!origin && destination) return { origin: "Port de Dakar", destination, display: `Port de Dakar → ${destination}`, confirmed: false };
  return { origin: "", destination: "", display: "Itinéraire en cours de confirmation", confirmed: false };
}

// ---------------------------------------------------------------- delay (D6)
export type DelayState = "normal" | "warning" | "high" | "critical";
export type PortalDelay = { state: DelayState; label: string; explanation: string | null };

const DELAY_LABEL: Record<DelayState, string> = {
  normal: "Dans les délais",
  warning: "Suivi recommandé",
  high: "Retard possible",
  critical: "Intervention en cours",
};

/** Map the internal risk level to a customer-safe 4-level state + plain explanation. */
export function deriveDelay(
  riskLevel: RiskLevel,
  facts: { missingDocs: number; customsInspection: boolean; awaitingPod: boolean },
): PortalDelay {
  const state: DelayState =
    riskLevel === "low" ? "normal" : riskLevel === "medium" ? "warning" : riskLevel === "high" ? "high" : "critical";

  let explanation: string | null = null;
  if (state !== "normal") {
    if (facts.customsInspection) explanation = "Le traitement douanier prend plus de temps que prévu.";
    else if (facts.missingDocs > 0) explanation = "Certains documents requis sont encore en cours de vérification.";
    else if (facts.awaitingPod) explanation = "La preuve de livraison est en attente.";
    else explanation = "Votre expédition fait l'objet d'un suivi rapproché par nos équipes.";
  }
  return { state, label: DELAY_LABEL[state], explanation };
}

// -------------------------------------------------------------- next step (D7)
export type NextStepParty = "effitrans" | "client" | "customs" | "carrier";
export type PortalNextStep = {
  milestoneKey: PortalStageKey | null;
  party: NextStepParty;
  title: string;
  explanation: string;
  clientAction: string | null;
};

/** The next customer-visible milestone, responsible party, and any required client action. */
export function deriveNextStep(
  currentStageKey: PortalStageKey | null,
  facts: { missingDocLabels: string[] },
): PortalNextStep {
  const missing = facts.missingDocLabels;
  switch (currentStageKey) {
    case "documents_received":
    case "documents_verified":
      if (missing.length > 0) {
        return {
          milestoneKey: "documents_verified",
          party: "client",
          title: "Validation des documents",
          explanation: "Certains documents requis sont nécessaires pour poursuivre le traitement.",
          clientAction: `Veuillez transmettre : ${missing.join(", ")}.`,
        };
      }
      return { milestoneKey: "documents_verified", party: "effitrans", title: "Vérification des documents", explanation: "Nos équipes vérifient vos documents.", clientAction: null };
    case "customs_in_progress":
    case "customs_done":
      return { milestoneKey: "customs_done", party: "customs", title: "Libération douanière", explanation: "Le dossier est en cours de traitement par les autorités douanières.", clientAction: null };
    case "transport_planned":
      return { milestoneKey: "in_transit", party: "carrier", title: "Enlèvement et transport", explanation: "Le transport de votre marchandise est en cours d'organisation.", clientAction: null };
    case "in_transit":
      return { milestoneKey: "delivered", party: "carrier", title: "Livraison", explanation: "Votre marchandise est en cours d'acheminement.", clientAction: null };
    case "delivered":
    case "invoiced":
      return { milestoneKey: "paid", party: "client", title: "Facturation", explanation: "Votre facture est disponible dans votre espace.", clientAction: null };
    case "paid":
    case null:
      return { milestoneKey: null, party: "effitrans", title: "Expédition finalisée", explanation: "Toutes les étapes de votre expédition sont terminées.", clientAction: null };
    case "created":
    default:
      return { milestoneKey: "documents_received", party: "effitrans", title: "Réception des documents", explanation: "Votre dossier est ouvert et en cours de préparation.", clientAction: null };
  }
}

// ------------------------------------------------------- document requirements (D5)
export type DocReqState = "requis" | "recu" | "en_verification" | "valide" | "a_remplacer";
export type DocRequirement = { code: string; label: string; state: DocReqState };

/** Customer-safe state per required document type — no internal rejection notes. */
export function documentRequirements(input: {
  requiredCodes: string[];
  bestStatusByCode: Map<string, string>;
  labelByCode: Map<string, string>;
}): DocRequirement[] {
  const stateOf = (status: string | undefined): DocReqState => {
    switch (status) {
      case "APPROVED":
        return "valide";
      case "REJECTED":
        return "a_remplacer";
      case "PENDING_REVIEW":
        return "en_verification";
      case "UPLOADED":
        return "recu";
      default:
        return "requis";
    }
  };
  return input.requiredCodes.map((code) => ({
    code,
    label: input.labelByCode.get(code) ?? code,
    state: stateOf(input.bestStatusByCode.get(code)),
  }));
}

// ------------------------------------------------------------ timeline (D4)
export type CustomerTimelineEntry = { id: string; title: string; date: string; category: string };

/**
 * Deduplicated, newest-first customer timeline. Always includes the creation
 * milestone so a real dossier is never empty; equivalent milestone/notification
 * events (same title) collapse to one.
 */
export function buildTimeline(input: {
  createdAt: string;
  createdLabel: string;
  notifications: { id: string; title: string; category: string; createdAt: string }[];
}): CustomerTimelineEntry[] {
  const entries: CustomerTimelineEntry[] = [
    { id: "created", title: input.createdLabel, date: input.createdAt, category: "CREATED" },
    ...input.notifications.map((n) => ({ id: n.id, title: n.title, date: n.createdAt, category: n.category })),
  ];
  const seen = new Set<string>();
  const deduped = entries.filter((e) => {
    const key = e.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

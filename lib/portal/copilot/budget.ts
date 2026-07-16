/**
 * Customer AI Assistant — deterministic context budgeting (Phase 7.6C). PURE.
 * ---------------------------------------------------------------------------
 * REUSES the shared budgeting primitives (lib/copilot/budget — BUDGET caps + capSerialized +
 * capsFor), exactly as the Logistics Copilot does. Only the CUSTOMER-DOMAIN part lives here: the
 * allowlisted keyword classifier for customer questions ("Où est mon expédition ?", "Pourquoi
 * est-elle en retard ?", …) and which sections each class prioritizes.
 *
 * The classifier is ALLOWLISTED and keyword-based: the model NEVER chooses what gets read, and a
 * non-prioritized section is trimmed but never emptied. Truncation is disclosed by the context
 * builder, never silent.
 */
import { BUDGET, capsFor, capSerialized } from "@/lib/copilot/budget";
import { PORTAL_SECTIONS, type PortalQuestionClass, type PortalSection } from "./types";

export { BUDGET, capSerialized };

/** Allowlisted keyword signatures (accent-folded) → customer question class. */
const KEYWORDS: Record<Exclude<PortalQuestionClass, "general">, string[]> = {
  location: ["ou est", "ou se trouve", "localisation", "position", "situe", "rendue", "actuellement", "navire", "vessel", "vol", "flight", "bateau"],
  delay: ["retard", "retarde", "pourquoi", "bloque", "bloquee", "probleme", "attente", "lent"],
  eta: ["quand", "arrivee", "arrivera", "recevoir", "livraison", "livree", "eta", "delai", "date"],
  documents: ["document", "manque", "manquant", "piece", "justificatif", "requis", "fournir", "telecharger", "connaissement", "facture proforma"],
  customs: ["douane", "dedouanement", "customs", "declaration", "bae", "mainlevee"],
  invoices: ["facture", "invoice", "paiement", "payer", "regler", "solde", "montant", "impaye"],
  contact: ["qui", "gere", "responsable", "contact", "interlocuteur", "joindre", "charge de compte", "dossier"],
  summary: ["resume", "resumer", "synthese", "recapitulatif", "point", "situation"],
  action: ["que dois", "que faire", "prochaine etape", "action", "attendu", "dois-je", "suivant"],
};

const fold = (s: string): string =>
  String(s ?? "").normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").toLowerCase();

/** Deterministic classification. Ties resolve by a fixed, most-specific-first class order. */
export function classifyPortalQuestion(question: string): PortalQuestionClass {
  const t = fold(question);
  let best: PortalQuestionClass = "general";
  let bestScore = 0;
  // Order matters only for ties: the more specific intents are checked first.
  for (const cls of ["customs", "invoices", "documents", "eta", "delay", "location", "contact", "action", "summary"] as const) {
    const score = KEYWORDS[cls].reduce((n, k) => (t.includes(k) ? n + 1 : n), 0);
    if (score > bestScore) { bestScore = score; best = cls; }
  }
  return best;
}

/** Sections prioritized per class (get the full cap). A summary/general question sees everything. */
export const PORTAL_PRIORITY: Record<PortalQuestionClass, PortalSection[]> = {
  location: ["shipment", "transport"],
  delay: ["shipment", "transport", "customs", "documents"],
  eta: ["shipment", "transport"],
  documents: ["documents", "shipment"],
  customs: ["customs", "documents", "shipment"],
  invoices: ["invoices", "shipment"],
  contact: ["contact", "shipment"],
  summary: ["shipment", "transport", "customs", "documents", "invoices", "notifications", "contact"],
  action: ["documents", "invoices", "shipment", "customs"],
  general: ["shipment", "transport", "customs", "documents", "invoices", "notifications", "contact"],
};

/** Per-section record cap for a question class — full cap when prioritized, reduced but never 0. */
export function portalSectionCaps(questionClass: PortalQuestionClass): Record<PortalSection, number> {
  return capsFor(PORTAL_SECTIONS, PORTAL_PRIORITY[questionClass]);
}

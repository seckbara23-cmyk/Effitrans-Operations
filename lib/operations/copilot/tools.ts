/**
 * Operations Copilot — question classification (Phase 10.0F). PURE.
 * ---------------------------------------------------------------------------
 * Deterministic keyword routing to a focus. It steers which context sections
 * the prompt emphasizes — it is NEVER a permission decision and NEVER queries
 * anything. Unmatched questions fall back to a full briefing.
 */
import type { CopilotFocus } from "./types";

const RULES: { focus: CopilotFocus; keywords: string[] }[] = [
  { focus: "priorities", keywords: ["priorit", "prioriser", "ce matin", "important", "focus", "concentrer"] },
  { focus: "briefing", keywords: ["résume", "resume", "synthèse", "synthese", "briefing", "matinal", "journée", "journee", "aujourd'hui"] },
  { focus: "finance", keywords: ["financ", "factur", "encaiss", "décaiss", "decaiss", "paiement", "recouvr", "créance", "creance", "rapprochement"] },
  { focus: "customs", keywords: ["douan", "déclaration", "declaration", "mainlevée", "mainlevee", "bae", "dédouan", "dedouan", "gainde"] },
  { focus: "transport", keywords: ["transport", "livraison", "livrer", "pod", "chauffeur", "camion", "expédition", "expedition", "navire", "vol", "conteneur"] },
  { focus: "messaging", keywords: ["message", "conversation", "communication", "notification", "client", "réponse", "reponse"] },
  { focus: "workload", keywords: ["charge", "surcharg", "département", "departement", "équipe", "equipe", "workload"] },
  { focus: "attention", keywords: ["attention", "alerte", "urgent", "bloqu", "risque", "intervention", "problème", "probleme"] },
  { focus: "kpi", keywords: ["kpi", "indicateur", "pourquoi", "augment", "évolu", "evolu", "changé", "change", "depuis hier"] },
];

export function classifyOperationsQuestion(question: string): CopilotFocus {
  const q = (question ?? "").toLowerCase();
  if (!q.trim()) return "briefing";
  for (const rule of RULES) {
    if (rule.keywords.some((k) => q.includes(k))) return rule.focus;
  }
  return "general";
}

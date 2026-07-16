/**
 * Logistics Copilot — deterministic context budgeting (Phase 7.6B, Part 8). PURE.
 * ---------------------------------------------------------------------------
 * Classifies the operator's question with an ALLOWLISTED, keyword-based classifier (the LLM
 * never chooses what runs), then allocates a per-module record cap that prioritizes the modules
 * relevant to the question. A prioritized module keeps the full cap; a non-prioritized module is
 * trimmed but NEVER emptied (a requested module always keeps records). Truncation is disclosed,
 * never silent. Also caps the total serialized brief size.
 *
 * 7.6C: the neutral caps + serialized-brief cap moved to lib/copilot/budget.ts so every copilot
 * budgets identically; they are re-exported here so this module's contract is unchanged. Only the
 * LOGISTICS-SPECIFIC classification (keywords, question classes, module priorities) lives here.
 */
import { BUDGET, capsFor, capSerialized } from "@/lib/copilot/budget";
import { LOGISTICS_MODULES, type LogisticsModule, type QuestionClass } from "./types";

export { BUDGET, capSerialized };

/** Allowlisted keyword signatures (folded) → question class. Order-independent. */
const KEYWORDS: Record<Exclude<QuestionClass, "general">, string[]> = {
  attention: ["attention", "action", "aujourd", "prioritaire", "urgent", "traiter"],
  customs: ["douane", "declaration", "customs", "bae", "gainde", "conformite", "regime", "bureau"],
  transport: ["navire", "vessel", "vol", "flight", "retard", "delay", "eta", "conteneur", "container", "arrivee", "transport", "livraison", "maritime", "aerien", "expedition", "cargo"],
  documents: ["document", "obligatoire", "manquant", "piece", "requis", "incomplet"],
  finance: ["facture", "invoice", "paiement", "impaye", "souffrance", "echeance", "finance", "recouvrement"],
  risk: ["risque", "risk", "critique", "danger", "eleve"],
  customer: ["client", "notifier", "informer", "notification", "prevenir", "avis"],
};

const fold = (s: string): string =>
  String(s ?? "").normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").toLowerCase();

/** Deterministic question classification (allowlisted). Ties resolve by fixed class order. */
export function classifyQuestion(question: string): QuestionClass {
  const t = fold(question);
  let best: QuestionClass = "general";
  let bestScore = 0;
  for (const cls of ["risk", "finance", "customs", "documents", "customer", "transport", "attention"] as const) {
    const score = KEYWORDS[cls].reduce((n, k) => (t.includes(k) ? n + 1 : n), 0);
    if (score > bestScore) { bestScore = score; best = cls; }
  }
  return best;
}

/** The modules prioritized for each question class (get the full cap). */
export const PRIORITY: Record<QuestionClass, LogisticsModule[]> = {
  attention: ["customs", "ocean", "air", "road", "documents", "finance"],
  customs: ["customs", "documents"],
  transport: ["ocean", "air", "road"],
  documents: ["documents", "customs"],
  finance: ["finance"],
  risk: ["customs", "ocean", "air", "road", "documents", "finance"],
  customer: ["ocean", "air", "customs", "documents"],
  general: ["customs", "ocean", "air", "road", "documents", "finance"],
};

/** Per-module record cap for a question class: full cap for prioritized modules, a reduced
 *  (non-zero) cap for the rest — so a requested module is never silently emptied. */
export function moduleCaps(questionClass: QuestionClass): Record<LogisticsModule, number> {
  return capsFor(LOGISTICS_MODULES, PRIORITY[questionClass]);
}

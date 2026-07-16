/**
 * Logistics Copilot — deterministic context budgeting (Phase 7.6B, Part 8). PURE.
 * ---------------------------------------------------------------------------
 * Classifies the operator's question with an ALLOWLISTED, keyword-based classifier (the LLM
 * never chooses what runs), then allocates a per-module record cap that prioritizes the modules
 * relevant to the question. A prioritized module keeps the full cap; a non-prioritized module is
 * trimmed but NEVER emptied (a requested module always keeps records). Truncation is disclosed,
 * never silent. Also caps the total serialized brief size.
 */
import type { LogisticsModule, QuestionClass } from "./types";

export const BUDGET = {
  /** Full per-module record cap for prioritized modules. */
  priorityCap: 25,
  /** Reduced cap for non-prioritized modules — trimmed, never zeroed. */
  minorCap: 8,
  /** Total serialized brief hard cap (chars) — well under the AI layer's 24k prompt cap. */
  maxSerializedChars: 12_000,
} as const;

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
  const prioritized = new Set(PRIORITY[questionClass]);
  const caps = {} as Record<LogisticsModule, number>;
  for (const m of ["road", "ocean", "air", "customs", "documents", "finance"] as LogisticsModule[]) {
    caps[m] = prioritized.has(m) ? BUDGET.priorityCap : BUDGET.minorCap;
  }
  return caps;
}

/** Cap the total serialized brief; report whether it was truncated. */
export function capSerialized(text: string): { text: string; truncated: boolean } {
  if (text.length <= BUDGET.maxSerializedChars) return { text, truncated: false };
  return { text: text.slice(0, BUDGET.maxSerializedChars) + "\n… [contexte tronqué]", truncated: true };
}

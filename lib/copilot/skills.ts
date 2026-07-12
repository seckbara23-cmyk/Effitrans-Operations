/**
 * Copilot operational skills (Phase AI-2a) — PURE, deterministic. No I/O.
 * ---------------------------------------------------------------------------
 * The Copilot is no longer one generic chat prompt: each operational question
 * maps to an explicit SKILL with a focused instruction fragment. The engine
 * detects the skill from the question BEFORE prompt construction, then the
 * prompt builder layers the skill fragment between the system prompt and the
 * dossier context (prompt routing — lib/copilot/prompt.ts).
 *
 * Detection is a transparent keyword score (French + English) with a fixed
 * priority tie-break — fully unit-tested, no model call, no hidden state.
 * Skills never grant data access or actions; they only shape wording. All hard
 * guardrails (permissions, read-only, no fabrication) live in the system prompt.
 */

/** The ten operational skills, plus a neutral fallback for free-form questions. */
export type CopilotSkill =
  | "shipment_summary"
  | "missing_documents"
  | "customs_status"
  | "tracking_status"
  | "delay_analysis"
  | "risk_summary"
  | "next_step"
  | "client_update"
  | "internal_handover"
  | "timeline_summary"
  | "general";

/** The user-selectable skills (the panel chips). `general` is detection-only. */
export const COPILOT_SKILLS: Exclude<CopilotSkill, "general">[] = [
  "shipment_summary",
  "missing_documents",
  "customs_status",
  "tracking_status",
  "delay_analysis",
  "risk_summary",
  "next_step",
  "client_update",
  "internal_handover",
  "timeline_summary",
];

export function isCopilotSkill(v: string): v is CopilotSkill {
  return v === "general" || (COPILOT_SKILLS as string[]).includes(v);
}

/**
 * Detection patterns per skill (French + English). More specific / generation
 * intents score first via the priority order below; `shipment_summary` is the
 * broad catch, and a zero score falls back to `general`.
 */
const PATTERNS: Record<Exclude<CopilotSkill, "general">, RegExp[]> = {
  client_update: [/client/i, /mise à jour.*client|message.*client|informer.*client|update.*client|notify.*client|draft.*client|rédige.*(au |pour le )?client/i],
  internal_handover: [/passation|handover|hand-?off|relève|transmission|note interne|hand over/i],
  missing_documents: [/document|pièce|justificatif|colisage|packing|certificat|manquant|manque|missing|à fournir|attente de pièce/i],
  customs_status: [/douane|customs|dédouan|mainlevée|\bbae\b|déclaration|regime|régime|hs ?code|inspection|bureau de douane/i],
  delay_analysis: [/retard|delay|en retard|late|pourquoi.*(tard|lent|attend|bloqu)|combien de temps|depuis quand.*bloqu/i],
  tracking_status: [/suivi|track|position|où est|localisation|\bgps\b|chauffeur|driver|camion|\beta\b|arriv|livraison en cours|en route/i],
  risk_summary: [/risqu|risk|danger|préoccup|alerte|attention particulière|criticité/i],
  timeline_summary: [/chronolog|timeline|historique|que s['’]est|what happened|hier|yesterday|aujourd['’]hui|today|a changé|changé|changed|évolution|déroul/i],
  next_step: [/prochaine étape|prochaine action|next step|next action|que faire|à faire ensuite|étape suivante|quelle est la suite|what should|should (we|ops|i) do/i],
  shipment_summary: [/résum|résumé|summary|summari[sz]e|vue d['’]ensemble|overview|point complet|fais le point|état du dossier|status of|où en est/i],
};

/** Priority for tie-breaks (earlier wins on equal score). */
const PRIORITY: Exclude<CopilotSkill, "general">[] = [
  "client_update",
  "internal_handover",
  "missing_documents",
  "customs_status",
  "delay_analysis",
  "tracking_status",
  "risk_summary",
  "timeline_summary",
  "next_step",
  "shipment_summary",
];

/** Score = number of distinct patterns matched for a skill. */
function scoreSkill(skill: Exclude<CopilotSkill, "general">, q: string): number {
  return PATTERNS[skill].reduce((n, re) => (re.test(q) ? n + 1 : n), 0);
}

/**
 * Detect the operational skill for a free-form question. Returns `general` when
 * nothing matches. Deterministic: highest score wins, ties broken by PRIORITY.
 */
export function detectSkill(question: string): CopilotSkill {
  const q = (question ?? "").trim();
  if (!q) return "general";
  let best: Exclude<CopilotSkill, "general"> | null = null;
  let bestScore = 0;
  for (const skill of PRIORITY) {
    const s = scoreSkill(skill, q);
    if (s > bestScore) {
      best = skill;
      bestScore = s;
    }
  }
  return best ?? "general";
}

/** Does the question ask for the message in English? (client_update language hint.) */
export function wantsEnglish(question: string): boolean {
  return /\b(in english|en anglais|english version|anglais)\b/i.test(question ?? "");
}

/**
 * The focused instruction fragment for a skill, injected as a second system
 * message. Empty for `general` (the base system prompt already covers free-form
 * Q&A). No fragment relaxes a guardrail — they only steer wording/structure.
 */
export function skillPrompt(skill: CopilotSkill, opts?: { english?: boolean }): string {
  switch (skill) {
    case "shipment_summary":
      return "OBJECTIF (Résumé) : Résume le dossier en 4 à 6 puces — statut et étape, département responsable, blocages actifs, documents (approuvés / manquants), transport/livraison, prochaine action. Concis et factuel.";
    case "missing_documents":
      return "OBJECTIF (Documents manquants) : Liste UNIQUEMENT les documents requis manquants indiqués dans la section DOCUMENTS (et DOUANE si présente). Si aucun ne manque, dis-le. N'invente aucun document et ne suppose pas d'exigence absente du dossier.";
    case "customs_status":
      return "OBJECTIF (Douane) : Décris l'état du dédouanement à partir de la section DOUANE — statut, régime, déclaration, mainlevée (BAE), inspection, documents douane manquants, et le blocage éventuel. Si la section est « ACCÈS NON AUTORISÉ », signale que tu n'y as pas accès sans spéculer.";
    case "tracking_status":
      return "OBJECTIF (Suivi) : Décris l'état du transport et du suivi à partir des sections TRANSPORT et SUIVI — statut, chauffeur, dernière position connue et sa fraîcheur, ETA (avec sa base et son niveau de confiance), incidents et retards récents. Ne prétends pas connaître une position en temps réel si les données sont anciennes ou absentes.";
    case "delay_analysis":
      return "OBJECTIF (Analyse du retard) : Explique le retard à partir des faits — blocages actifs, incidents et retards signalés, statut SLA, étape courante. Distingue clairement la cause CONNUE de ce qui est INCONNU. Ne devine pas une cause absente du dossier.";
    case "risk_summary":
      return "OBJECTIF (Risques) : Reprends la section RISQUE (moteur de risque) — niveau, raisons, actions. Ne recalcule pas de score et n'ajoute pas de risque absent de cette section.";
    case "next_step":
      return "OBJECTIF (Prochaine étape) : Indique la ou les prochaine(s) action(s) opérationnelle(s) à partir du CYCLE DE VIE et de la section RISQUE. Préfixe chaque recommandation par « Action suggérée : ». Tu ne peux pas exécuter ces actions — ne prétends jamais les avoir faites.";
    case "client_update":
      return [
        "OBJECTIF (Mise à jour client) : Rédige un message client professionnel, prêt à copier, fondé UNIQUEMENT sur des faits partageables.",
        "- N'inclus JAMAIS : notes internes, seuils SLA, incidents internes, montants d'une section finance masquée, ni aucune donnée marquée « ACCÈS NON AUTORISÉ ».",
        opts?.english
          ? "- Rédige le message en ANGLAIS (le reste de ta réponse peut rester en français)."
          : "- Rédige le message en FRANÇAIS (propose une version anglaise seulement si on te le demande).",
      ].join("\n");
    case "internal_handover":
      return "OBJECTIF (Note de passation interne) : Rédige une note interne concise (3 à 6 lignes) pour un collègue qui reprend le dossier — statut et département responsable, blocages, transport/ETA, finance et POD en attente, prochaine action. Factuel, sans fioritures.";
    case "timeline_summary":
      return "OBJECTIF (Chronologie) : Reconstitue l'ordre des événements à partir des sections CHRONOLOGIE / SUIVI et de l'avancement du cycle de vie. Réponds aux questions temporelles (hier, aujourd'hui, depuis quand) uniquement avec les dates présentes ; si une date est absente, dis-le.";
    case "general":
      return "";
  }
}

/**
 * Logistics Copilot — deterministic recommendation engine (Phase 7.6A + 7.6B). PURE.
 * ---------------------------------------------------------------------------
 * Builds operational cards from the bounded, read-only context — NO model, NO fabrication. A card
 * is emitted ONLY when its module was consulted AND real records exist; an unavailable module
 * produces NO false "all-clear" (Missing ≠ Negative). Each card carries finding / evidence (records
 * with real identifiers + safe status/timestamp for the evidence panel) / confidence / reasoning /
 * suggested action / source modules / timestamp. This same output is the provider-down fallback.
 * 7.6B: real portfolio-risk card, required-document states (distinct from the OCR queue), safe
 * doc-intelligence evidence, grounded customer-notification, and richer overdue invoices.
 */
import type { CardKind, Confidence, EvidenceRecord, LogisticsContext, LogisticsModule, RecommendationCard, CopilotAlert } from "./types";
import { CARD_TITLE } from "./types";

const REJECTED_STATUSES = ["REJECTED", "CANCELLED"];

function card(
  kind: CardKind, finding: string, evidence: EvidenceRecord[], confidence: Confidence,
  reasoning: string, suggestedAction: string, sourceModules: LogisticsModule[], timestamp: string,
): RecommendationCard {
  return { kind, title: CARD_TITLE[kind], finding, evidence, confidence, reasoning, suggestedAction, sourceModules, timestamp };
}

const modeToModule = (m: string): LogisticsModule | undefined => (["road", "ocean", "air", "customs"] as string[]).includes(m) ? (m as LogisticsModule) : undefined;
const alertEvidence = (a: CopilotAlert): EvidenceRecord => ({ label: a.clientName ?? "—", reference: a.reference, detail: a.reason, link: a.link, module: modeToModule(a.mode), status: a.severity });
const confFromRefs = (rows: { reference: string | null }[]): Confidence => (rows.some((r) => r.reference) ? "HIGH" : "MEDIUM");

/** Build the deterministic recommendation cards from the assembled context. */
export function buildRecommendations(ctx: LogisticsContext): RecommendationCard[] {
  const out: RecommendationCard[] = [];
  const ts = ctx.generatedAt;

  // Blocked customs.
  if (ctx.authorized.customs && ctx.blockedCustoms.length > 0) {
    const ev = ctx.blockedCustoms.map((d): EvidenceRecord => ({ label: d.clientName ?? d.fileNumber ?? "—", reference: d.reference ?? d.fileNumber, detail: `${d.status}${d.office ? ` · ${d.office}` : ""}`, link: d.link, module: "customs", status: d.status }));
    out.push(card("BLOCKED_CUSTOMS", `${ctx.blockedCustoms.length} déclaration(s) douanière(s) bloquée(s).`, ev, "HIGH",
      "Statut de déclaration bloquant (rejet, annulation ou attente de paiement) lu sur le registre douanier.",
      "Ouvrir la déclaration concernée et lever le blocage (paiement / correction / soumission).", ["customs"], ts));

    const rejected = ctx.blockedCustoms.filter((d) => REJECTED_STATUSES.includes(d.status));
    if (rejected.length > 0) {
      const rev = rejected.map((d): EvidenceRecord => ({ label: d.clientName ?? d.fileNumber ?? "—", reference: d.reference ?? d.fileNumber, detail: d.status, link: d.link, module: "customs", status: d.status }));
      out.push(card("COMPLIANCE_WARNING", `${rejected.length} déclaration(s) rejetée(s)/annulée(s) — risque de conformité.`, rev, "HIGH",
        "Une déclaration rejetée ou annulée indique une non-conformité à corriger avant de poursuivre.",
        "Analyser le motif de rejet et corriger la déclaration avant nouvelle soumission.", ["customs"], ts));
    }
  }

  // Delayed vessels / late flights.
  const ocean = ctx.attention.filter((a) => a.mode === "ocean");
  if (ocean.length > 0) out.push(card("DELAYED_VESSEL", `${ocean.length} alerte(s) maritime(s) (retard / suivi obsolète / exception).`, ocean.map(alertEvidence), confFromRefs(ocean),
    "Alertes de la file d'attention maritime consolidée.", "Ouvrir l'expédition maritime et vérifier l'ETA / la dernière position.", ["ocean"], ts));
  const air = ctx.attention.filter((a) => a.mode === "air");
  if (air.length > 0) out.push(card("LATE_FLIGHT", `${air.length} alerte(s) aérienne(s) (retard / exception).`, air.map(alertEvidence), confFromRefs(air),
    "Alertes de la file d'attention aérienne consolidée.", "Ouvrir l'expédition aérienne et vérifier l'ETA du vol.", ["air"], ts));

  // Real portfolio-risk card (reuses assessRisk over the bounded signals).
  if (ctx.portfolioRisk.length > 0) {
    const ev = ctx.portfolioRisk.map((r): EvidenceRecord => ({ label: `Niveau ${r.level}`, reference: r.fileNumber, detail: `score ${r.score} · ${r.contributors.slice(0, 2).join(" ; ")}`, link: r.link, module: r.modes[0], status: r.level }));
    const modes = Array.from(new Set(ctx.portfolioRisk.flatMap((r) => r.modes)));
    const anyHigh = ctx.portfolioRisk.some((r) => r.level === "critical" || r.level === "high");
    out.push(card("RISK_SHIPMENT", `${ctx.portfolioRisk.length} dossier(s) à risque, classés par score.`, ev, anyHigh ? "HIGH" : "MEDIUM",
      "Projection de risque déterministe (moteur assessRisk) sur les signaux bornés disponibles. Le SLA et le cycle de vie détaillés ne sont pas évalués au niveau portefeuille — les scores sont un plancher, non une évaluation exhaustive.",
      "Ouvrir les dossiers à risque les plus élevés et lever la cause principale.", modes.length ? modes : ["customs"], ts));
  }

  // Upcoming arrivals.
  const arrivals = ctx.upcoming.filter((u) => u.mode === "ocean" || u.mode === "air");
  if (arrivals.length > 0) {
    const ev = arrivals.map((u): EvidenceRecord => ({ label: u.clientName ?? "—", reference: u.reference, detail: `${u.route} · ${u.at.slice(0, 10)}`, link: u.link, module: modeToModule(u.mode), timestamp: u.at }));
    out.push(card("UPCOMING_ETA", `${arrivals.length} arrivée(s) datée(s) à venir.`, ev, "HIGH",
      "Mouvements maritimes/aériens avec une ETA dans la fenêtre à venir (données datées).",
      "Préparer la mainlevée / l'enlèvement et anticiper les documents requis.", ["ocean", "air"], ts));
  }

  // Grounded customer-notification suggestions (recommendation only; no contact values).
  if (ctx.notifyOpportunities.length > 0) {
    const ev = ctx.notifyOpportunities.map((n): EvidenceRecord => ({ label: n.clientName ?? "—", reference: n.reference, detail: n.reason, link: n.link, module: modeToModule(n.mode), status: n.alreadyNotified ? "déjà notifié" : "à vérifier" }));
    out.push(card("CUSTOMER_NOTIFICATION", `${ctx.notifyOpportunities.length} client(s) potentiellement à informer.`, ev, "MEDIUM",
      "Événements clients pertinents (arrivée imminente, mainlevée/blocage douanier). Suggestion, pas un envoi — aucune coordonnée client n'est traitée par le modèle.",
      "Vérifier si le client a déjà été notifié dans le portail, puis proposer une notification (action manuelle).", ["ocean", "air", "customs"], ts));
  }

  // Overdue invoices (finance-gated, richer detail).
  if (ctx.authorized.finance && ctx.overdueInvoices.length > 0) {
    const ev = ctx.overdueInvoices.map((i): EvidenceRecord => ({ label: i.clientName ?? i.fileNumber ?? "—", reference: i.invoiceNumber, detail: `${i.balance} ${i.currency} · ${i.daysOverdue} j de retard · ${i.paymentState}`, link: i.link, module: "finance", status: i.paymentState, timestamp: i.dueDate }));
    out.push(card("OVERDUE_INVOICE", `${ctx.overdueInvoices.length} facture(s) en souffrance.`, ev, "HIGH",
      "Factures émises dont l'échéance est dépassée et le solde non réglé.",
      "Relancer le recouvrement — ouvrir la facture et suivre le paiement.", ["finance"], ts));
  }

  // Missing REQUIRED documents (distinct from the OCR review queue) + safe doc-intelligence evidence.
  if (ctx.authorized.document && (ctx.missingDocs.length > 0 || ctx.docIntelJobs.length > 0)) {
    const reqEv = ctx.missingDocs.map((d): EvidenceRecord => ({ label: d.documentType, reference: d.fileNumber, detail: d.state === "MISSING" ? "obligatoire manquant" : d.state === "EXPIRED" ? `expiré${d.due ? ` (${d.due.slice(0, 10)})` : ""}` : "en attente de revue", link: d.link, module: "documents", status: d.state }));
    const diEv = ctx.docIntelJobs.map((j): EvidenceRecord => ({ label: j.fileNumber ?? "—", reference: j.documentId.slice(0, 8), detail: `${j.ocrRequired ? "OCR requis" : j.state === "FAILED" ? `échec (${j.failureCategory ?? "—"})` : `à revoir`}${j.conflictCount ? ` · ${j.conflictCount} conflit(s)` : ""}`, link: j.link, module: "documents", status: j.state }));
    const req = ctx.missingDocs.length;
    const di = ctx.docIntelJobs.length;
    out.push(card("MISSING_DOCUMENT", `${req} document(s) obligatoire(s) manquant(s)/expiré(s)/en attente ; ${di} extraction(s) à revoir.`, [...reqEv, ...diEv], "HIGH",
      "Analyse des exigences documentaires (catalogue required_for) — un document obligatoire manquant/expiré N'EST PAS la même chose qu'une extraction OCR en file de revue ; les deux sont distingués ici.",
      "Réclamer/téléverser les documents obligatoires manquants et traiter les extractions à revoir.", ["documents"], ts));
  }

  return out;
}

/** Deterministic French summary — also the provider-unavailable fallback answer. */
export function deterministicSummary(ctx: LogisticsContext, cards: RecommendationCard[]): string {
  const lines: string[] = [];
  lines.push(`Synthèse logistique déterministe (instantané du ${ctx.generatedAt.slice(0, 16).replace("T", " ")}, question : ${ctx.questionClass}).`);
  if (ctx.headline) {
    const h = ctx.headline;
    lines.push(`Mouvements en cours : ${h.movementsInProgress} · Arrivées ≤7 j : ${h.arrivingWithin7Days} · En retard : ${h.overdueOps} · Alertes critiques : ${h.criticalAlerts} · En attente douane : ${h.awaitingCustoms} · Exceptions : ${h.exceptions}.`);
  }
  if (cards.length === 0) lines.push("Aucune recommandation à signaler dans les modules consultés.");
  else { lines.push(`${cards.length} recommandation(s) :`); for (const c of cards) lines.push(`• ${c.title} — ${c.finding} (confiance ${c.confidence}; source : ${c.sourceModules.join(", ")}).`); }
  lines.push(`Modules consultés : ${ctx.modules.length ? ctx.modules.join(", ") : "aucun"}.`);
  if (ctx.unavailable.length) lines.push(`Modules NON inclus dans cet instantané (donnée manquante ≠ absence de problème) : ${ctx.unavailable.join(", ")}.`);
  if (ctx.truncated.length) lines.push(`Contexte tronqué pour : ${ctx.truncated.join(", ")} (limite par module atteinte).`);
  return lines.join("\n");
}

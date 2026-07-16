/**
 * Logistics Copilot — deterministic recommendation engine (Phase 7.6A). PURE.
 * ---------------------------------------------------------------------------
 * Builds operational cards from the bounded, read-only context — NO model, NO fabrication. A
 * card is emitted ONLY when its module was consulted AND real records exist; an unavailable
 * module produces NO false "all-clear" (Missing ≠ Negative). Each card carries finding /
 * evidence (records with real identifiers) / confidence / reasoning / suggested action /
 * source modules / timestamp. This same output is the provider-down fallback.
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

const alertEvidence = (a: CopilotAlert): EvidenceRecord => ({ label: a.clientName ?? "—", reference: a.reference, detail: a.reason, link: a.link });
/** Concrete identified records ⇒ HIGH; otherwise MEDIUM (a real signal, but no citation id). */
const confFromRefs = (rows: { reference: string | null }[]): Confidence => (rows.some((r) => r.reference) ? "HIGH" : "MEDIUM");

/** Build the deterministic recommendation cards from the assembled context. */
export function buildRecommendations(ctx: LogisticsContext): RecommendationCard[] {
  const out: RecommendationCard[] = [];
  const ts = ctx.generatedAt;

  // Blocked customs — real declaration references.
  if (ctx.authorized.customs && ctx.blockedCustoms.length > 0) {
    const ev = ctx.blockedCustoms.map((d): EvidenceRecord => ({ label: d.clientName ?? d.fileNumber ?? "—", reference: d.reference ?? d.fileNumber, detail: `${d.status}${d.office ? ` · ${d.office}` : ""}`, link: d.link }));
    out.push(card("BLOCKED_CUSTOMS", `${ctx.blockedCustoms.length} déclaration(s) douanière(s) bloquée(s).`, ev, "HIGH",
      "Statut de déclaration bloquant (rejet, annulation ou attente de paiement) lu sur le registre douanier.",
      "Ouvrir la déclaration concernée et lever le blocage (paiement / correction / soumission).", ["customs"], ts));

    // Compliance angle — the REJECTED/CANCELLED subset is a compliance failure needing correction.
    const rejected = ctx.blockedCustoms.filter((d) => REJECTED_STATUSES.includes(d.status));
    if (rejected.length > 0) {
      const rev = rejected.map((d): EvidenceRecord => ({ label: d.clientName ?? d.fileNumber ?? "—", reference: d.reference ?? d.fileNumber, detail: d.status, link: d.link }));
      out.push(card("COMPLIANCE_WARNING", `${rejected.length} déclaration(s) rejetée(s)/annulée(s) — risque de conformité.`, rev, "HIGH",
        "Une déclaration rejetée ou annulée indique une non-conformité à corriger avant de poursuivre.",
        "Analyser le motif de rejet et corriger la déclaration avant nouvelle soumission.", ["customs"], ts));
    }
  }

  // Delayed vessels — ocean attention alerts.
  const ocean = ctx.attention.filter((a) => a.mode === "ocean");
  if (ocean.length > 0) {
    out.push(card("DELAYED_VESSEL", `${ocean.length} alerte(s) maritime(s) (retard / suivi obsolète / exception).`, ocean.map(alertEvidence), confFromRefs(ocean),
      "Alertes de la file d'attention maritime consolidée (retard d'escale, position obsolète ou exception).",
      "Ouvrir l'expédition maritime et vérifier l'ETA / la dernière position.", ["ocean"], ts));
  }

  // Late flights — air attention alerts.
  const air = ctx.attention.filter((a) => a.mode === "air");
  if (air.length > 0) {
    out.push(card("LATE_FLIGHT", `${air.length} alerte(s) aérienne(s) (retard / exception).`, air.map(alertEvidence), confFromRefs(air),
      "Alertes de la file d'attention aérienne consolidée.",
      "Ouvrir l'expédition aérienne et vérifier l'ETA du vol.", ["air"], ts));
  }

  // Critical, cross-modal → risk shipments.
  const critical = ctx.attention.filter((a) => a.severity === "critical");
  if (critical.length > 0) {
    const modes = Array.from(new Set(critical.map((a) => a.mode))).filter((m): m is LogisticsModule => (["road", "ocean", "air", "customs"] as string[]).includes(m));
    out.push(card("RISK_SHIPMENT", `${critical.length} expédition(s) à risque élevé (alertes critiques).`, critical.map(alertEvidence), confFromRefs(critical),
      "Alertes de sévérité critique dans la file d'attention inter-modale.",
      "Traiter en priorité — ouvrir chaque dossier et lever la cause de l'alerte.", modes.length ? modes : ["road"], ts));
  }

  // Upcoming arrivals — dated movements.
  const arrivals = ctx.upcoming.filter((u) => u.mode === "ocean" || u.mode === "air");
  if (arrivals.length > 0) {
    const ev = arrivals.map((u): EvidenceRecord => ({ label: u.clientName ?? "—", reference: u.reference, detail: `${u.route} · ${u.at.slice(0, 10)}`, link: u.link }));
    out.push(card("UPCOMING_ETA", `${arrivals.length} arrivée(s) datée(s) à venir.`, ev, "HIGH",
      "Mouvements maritimes/aériens avec une ETA dans la fenêtre à venir (données datées).",
      "Préparer la mainlevée / l'enlèvement et anticiper les documents requis.", ["ocean", "air"], ts));

    // Customer-notification suggestion (a SUGGESTION — the copilot never sends anything).
    out.push(card("CUSTOMER_NOTIFICATION", `${arrivals.length} client(s) pourraient être informés d'une arrivée imminente.`, ev, "MEDIUM",
      "Des arrivées sont imminentes ; informer proactivement le client améliore le service. Il s'agit d'une suggestion, pas d'un envoi.",
      "Proposer une notification via le portail client (action manuelle par l'opérateur).", ["ocean", "air"], ts));
  }

  // Overdue invoices — finance-gated, real invoice numbers.
  if (ctx.authorized.finance && ctx.overdueInvoices.length > 0) {
    const ev = ctx.overdueInvoices.map((i): EvidenceRecord => ({ label: i.clientName ?? i.fileNumber ?? "—", reference: i.invoiceNumber, detail: `${i.balance} ${i.currency}${i.dueDate ? ` · échéance ${i.dueDate.slice(0, 10)}` : ""}`, link: i.link }));
    out.push(card("OVERDUE_INVOICE", `${ctx.overdueInvoices.length} facture(s) en souffrance.`, ev, "HIGH",
      "Factures émises dont l'échéance est dépassée et le solde non réglé.",
      "Relancer le recouvrement — ouvrir la facture et suivre le paiement.", ["finance"], ts));
  }

  // Documents needing review (OCR extraction review — NOT missing-required, which is 7.6B).
  if (ctx.authorized.document && ctx.docReview && (ctx.docReview.readyForReview > 0 || ctx.docReview.failed > 0)) {
    const ev: EvidenceRecord[] = [
      { label: "À revoir", reference: String(ctx.docReview.readyForReview), detail: "Extractions prêtes pour revue humaine", link: "/files" },
      { label: "Échecs", reference: String(ctx.docReview.failed), detail: "Extractions en échec", link: "/files" },
    ];
    out.push(card("MISSING_DOCUMENT", `${ctx.docReview.readyForReview} extraction(s) à revoir, ${ctx.docReview.failed} en échec.`, ev, "MEDIUM",
      "Compteurs de la file d'intelligence documentaire (revue d'extraction). Ceci ne couvre pas les documents requis manquants par dossier (Phase 7.6B).",
      "Ouvrir la revue documentaire et valider / relancer les extractions.", ["documents"], ts));
  }

  return out;
}

/** Deterministic French summary — also the provider-unavailable fallback answer. */
export function deterministicSummary(ctx: LogisticsContext, cards: RecommendationCard[]): string {
  const lines: string[] = [];
  lines.push(`Synthèse logistique déterministe (instantané du ${ctx.generatedAt.slice(0, 16).replace("T", " ")}).`);
  if (ctx.headline) {
    const h = ctx.headline;
    lines.push(`Mouvements en cours : ${h.movementsInProgress} · Arrivées ≤7 j : ${h.arrivingWithin7Days} · En retard : ${h.overdueOps} · Alertes critiques : ${h.criticalAlerts} · En attente douane : ${h.awaitingCustoms} · Exceptions : ${h.exceptions}.`);
  }
  if (cards.length === 0) {
    lines.push("Aucune recommandation à signaler dans les modules consultés.");
  } else {
    lines.push(`${cards.length} recommandation(s) :`);
    for (const c of cards) lines.push(`• ${c.title} — ${c.finding} (confiance ${c.confidence}; source : ${c.sourceModules.join(", ")}).`);
  }
  lines.push(`Modules consultés : ${ctx.modules.length ? ctx.modules.join(", ") : "aucun"}.`);
  if (ctx.unavailable.length) lines.push(`Modules NON inclus dans cet instantané (donnée manquante ≠ absence de problème) : ${ctx.unavailable.join(", ")}.`);
  return lines.join("\n");
}

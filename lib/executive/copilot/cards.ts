/**
 * Executive Copilot — deterministic recommendation engine (Phase 7.7). PURE.
 * ---------------------------------------------------------------------------
 * Builds executive cards from the ALREADY-COMPOSED ExecutiveIntelligence snapshot — NO model, NO
 * fabrication, NO new query. Same discipline as its two siblings:
 *   - a card is emitted ONLY when its section was composed AND real figures exist;
 *   - a section that is `unavailable` produces NO card and NO false all-clear (Missing ≠ Negative);
 *   - this same output is the provider-down fallback, so the panel always answers.
 *
 * Every threshold below is a DISPLAY rule for "is this worth an executive's attention", never a
 * re-derivation of an operational fact: the underlying numbers (risk, SLA, overdue, alert
 * severity) were already computed by the owning engines and are quoted verbatim.
 */
import type { ExecutiveIntelligence, ExecutiveSection } from "../types";
import type { ExecCardKind, ExecConfidence, ExecEvidence, ExecRecommendationCard } from "./types";
import { EXEC_CARD_TITLE } from "./types";
import { DRILL } from "../links";

/** Attention thresholds — presentation only (what an executive should be shown), not domain logic. */
const T = {
  overdueOps: 1,
  customsQueue: 3,
  docBacklog: 5,
  criticalAlerts: 1,
  aiFallbackRatePct: 25,
} as const;

function card(
  kind: ExecCardKind, finding: string, evidence: ExecEvidence[], confidence: ExecConfidence,
  reasoning: string, suggestedAction: string, sections: ExecutiveSection[], timestamp: string,
): ExecRecommendationCard {
  return { kind, title: EXEC_CARD_TITLE[kind], finding, evidence, confidence, reasoning, suggestedAction, sections, timestamp };
}

const has = (ctx: ExecutiveIntelligence, s: ExecutiveSection) => ctx.sections.includes(s);
const num = (n: number | null | undefined): n is number => typeof n === "number";

export function buildExecutiveRecommendations(ctx: ExecutiveIntelligence): ExecRecommendationCard[] {
  const out: ExecRecommendationCard[] = [];
  const ts = ctx.generatedAt;
  const f = ctx.financial;
  const h = ctx.operations?.headline ?? null;

  // ---- Cash collection risk + revenue risk (finance-gated; silent without finance:read) ----
  if (has(ctx, "financial") && f) {
    if (num(f.outstanding) && f.outstanding > 0) {
      const ev: ExecEvidence[] = [
        { label: "Encours à recouvrer", value: `${Math.round(f.outstanding).toLocaleString("fr-FR")} ${f.currency}`, href: DRILL.financial, section: "financial" },
        ...f.aging.filter((a) => a.value > 0).map((a): ExecEvidence => ({ label: `Ancienneté ${a.bucket}`, value: `${Math.round(a.value).toLocaleString("fr-FR")} ${f.currency}`, href: DRILL.financial, section: "financial" })),
        ...(num(f.avgPaymentDelayDays) ? [{ label: "Délai moyen de paiement", value: `${f.avgPaymentDelayDays} j`, href: DRILL.financial, section: "financial" as ExecutiveSection }] : []),
      ];
      const over90 = f.aging.find((a) => a.bucket === "> 90 j")?.value ?? 0;
      out.push(card("CASH_COLLECTION_RISK",
        `${Math.round(f.outstanding).toLocaleString("fr-FR")} ${f.currency} d'encours client${over90 > 0 ? `, dont ${Math.round(over90).toLocaleString("fr-FR")} ${f.currency} à plus de 90 jours` : ""}.`,
        ev, over90 > 0 ? "HIGH" : "MEDIUM",
        "Balance âgée calculée par le moteur financier existant sur les factures émises non soldées.",
        "Ouvrir Finance et prioriser le recouvrement des créances les plus anciennes.",
        ["financial"], ts));

      if (f.topOverdueClients.length > 0) {
        out.push(card("HIGH_RISK_CUSTOMERS",
          `${f.topOverdueClients.length} client(s) concentrent l'essentiel de l'encours échu.`,
          f.topOverdueClients.map((c): ExecEvidence => ({ label: c.clientName ?? "—", value: `${Math.round(c.outstanding).toLocaleString("fr-FR")} ${f.currency}`, href: DRILL.customers, section: "customers" })),
          "HIGH",
          "Concentration de l'encours échu par client, issue du moteur financier existant.",
          "Revoir les conditions de paiement et l'exposition commerciale de ces comptes.",
          ["financial", "customers"], ts));
      }
    }

    if (num(f.revenueThisMonth) && num(f.outstanding) && f.revenueThisMonth > 0 && f.outstanding > f.revenueThisMonth) {
      out.push(card("REVENUE_RISK",
        `L'encours (${Math.round(f.outstanding).toLocaleString("fr-FR")} ${f.currency}) dépasse le revenu facturé du mois (${Math.round(f.revenueThisMonth).toLocaleString("fr-FR")} ${f.currency}).`,
        [
          { label: "Revenu du mois", value: `${Math.round(f.revenueThisMonth).toLocaleString("fr-FR")} ${f.currency}`, href: DRILL.financial, section: "financial" },
          { label: "Encours", value: `${Math.round(f.outstanding).toLocaleString("fr-FR")} ${f.currency}`, href: DRILL.financial, section: "financial" },
        ],
        "MEDIUM",
        "Comparaison de deux agrégats financiers existants — un indicateur de trésorerie, pas une prévision.",
        "Examiner le cycle facturation → encaissement avec la direction financière.",
        ["financial"], ts));
    }
  }

  // ---- Operational bottleneck / late deliveries / capacity ----
  if (has(ctx, "operations") && h) {
    if (h.overdueOps >= T.overdueOps) {
      out.push(card("LATE_DELIVERIES",
        `${h.overdueOps} opération(s) en retard sur l'ensemble des modes.`,
        [
          { label: "Opérations en retard", value: String(h.overdueOps), href: DRILL.operations, section: "operations" },
          ...(num(ctx.performance?.avgDeliveryDays) ? [{ label: "Livraison moyenne", value: `${ctx.performance!.avgDeliveryDays} j`, href: DRILL.operations, section: "operations" as ExecutiveSection }] : []),
        ],
        "HIGH",
        "Compte consolidé de la tour de contrôle logistique (route/maritime/aérien).",
        "Ouvrir le centre d'opérations et traiter les mouvements en retard.",
        ["operations"], ts));
    }

    if (h.exceptions > 0 || h.criticalAlerts >= T.criticalAlerts) {
      const modules = (ctx.operations?.modules ?? []).filter((m) => m.state === "critical" || m.state === "attention");
      out.push(card("OPERATIONAL_BOTTLENECK",
        `${h.criticalAlerts} alerte(s) critique(s) et ${h.exceptions} exception(s) en cours.`,
        modules.map((m): ExecEvidence => ({ label: m.mode, value: m.state, detail: m.kpis.slice(0, 2).map((k) => `${k.label}=${k.value}`).join(" · "), href: m.href, section: "operations" })),
        h.criticalAlerts > 0 ? "HIGH" : "MEDIUM",
        "État par module issu de la tour de contrôle — chaque module a évalué son propre état.",
        "Ouvrir le module concerné et lever la cause principale.",
        ["operations"], ts));
    }

    if (h.movementsInProgress > 0 && h.arrivingWithin7Days > 0 && h.arrivingWithin7Days >= h.movementsInProgress) {
      out.push(card("CAPACITY_WARNING",
        `${h.arrivingWithin7Days} arrivée(s) prévues sous 7 jours pour ${h.movementsInProgress} mouvement(s) en cours.`,
        [
          { label: "Arrivées ≤ 7 j", value: String(h.arrivingWithin7Days), href: DRILL.operations, section: "operations" },
          { label: "Mouvements en cours", value: String(h.movementsInProgress), href: DRILL.operations, section: "operations" },
        ],
        "MEDIUM",
        "Concentration d'arrivées à court terme — indicateur de charge, pas une prévision de capacité.",
        "Anticiper la capacité d'enlèvement, de dédouanement et d'entreposage.",
        ["operations"], ts));
    }
  }

  // ---- Customs congestion ----
  if (has(ctx, "customs") && h && h.awaitingCustoms >= T.customsQueue) {
    const customsCard = (ctx.operations?.modules ?? []).find((m) => m.mode === "customs");
    out.push(card("CUSTOMS_CONGESTION",
      `${h.awaitingCustoms} dossier(s) en attente de douane.`,
      [
        { label: "En attente de douane", value: String(h.awaitingCustoms), href: DRILL.customs, section: "customs" },
        ...(customsCard?.kpis ?? []).map((k): ExecEvidence => ({ label: k.label, value: String(k.value), href: DRILL.customs, section: "customs" })),
        ...(num(ctx.performance?.avgCustomsDays) ? [{ label: "Dédouanement moyen", value: `${ctx.performance!.avgCustomsDays} j`, href: DRILL.customs, section: "customs" as ExecutiveSection }] : []),
      ],
      "HIGH",
      "File douanière consolidée du module Customs Intelligence.",
      "Ouvrir Customs Intelligence et lever les déclarations bloquées.",
      ["customs"], ts));
  }

  // ---- Growing delays (grounded in measured averages, never a trend the data cannot support) ----
  const p = ctx.performance;
  if (p && num(p.avgCustomsDays) && num(p.avgDeliveryDays) && h && h.overdueOps > 0) {
    out.push(card("GROWING_DELAYS",
      `Délais moyens mesurés : ${p.avgCustomsDays} j en douane, ${p.avgDeliveryDays} j en livraison.`,
      [
        { label: "Dédouanement moyen", value: `${p.avgCustomsDays} j`, href: DRILL.customs, section: "customs" },
        { label: "Livraison moyenne", value: `${p.avgDeliveryDays} j`, href: DRILL.operations, section: "operations" },
        ...(num(p.timeToInvoiceDays) ? [{ label: "Délai de facturation", value: `${p.timeToInvoiceDays} j`, href: DRILL.financial, section: "financial" as ExecutiveSection }] : []),
      ],
      "MEDIUM",
      "Moyennes calculées par la tour de contrôle sur les dossiers réels. Ce sont des NIVEAUX mesurés, pas une tendance : aucun historique période-sur-période n'est conservé, donc aucune progression n'est affirmée.",
      "Comparer avec les objectifs internes et arbitrer les priorités opérationnelles.",
      ["operations", "customs"], ts));
  }

  // ---- Document backlog ----
  const d = ctx.documents;
  if (has(ctx, "documents") && d) {
    const backlog = (d.reviewQueue ?? 0) + (d.failed ?? 0) + (d.unresolvedConflicts ?? 0);
    if (backlog >= T.docBacklog) {
      const ev: ExecEvidence[] = [];
      if (num(d.reviewQueue)) ev.push({ label: "À revoir", value: String(d.reviewQueue), href: DRILL.documents, section: "documents" });
      if (num(d.failed)) ev.push({ label: "Extractions en échec", value: String(d.failed), href: DRILL.documents, section: "documents" });
      if (num(d.unresolvedConflicts)) ev.push({ label: "Conflits non résolus", value: String(d.unresolvedConflicts), href: DRILL.documents, section: "documents" });
      if (num(d.queued)) ev.push({ label: "En file", value: String(d.queued), href: DRILL.documents, section: "documents" });
      out.push(card("DOCUMENT_BACKLOG",
        `${backlog} élément(s) en attente dans la chaîne documentaire.`,
        ev, "MEDIUM",
        "File de revue du module Document Intelligence. Les documents obligatoires manquants ne sont PAS comptés ici — aucun lecteur global ne les expose (voir la documentation).",
        "Ouvrir le service Documentation et résorber la file de revue.",
        ["documents"], ts));
    }
  }

  // ---- AI provider availability ----
  const ai = ctx.ai;
  if (has(ctx, "ai") && ai) {
    const fallbackRate = ai.total > 0 ? (ai.fallback / ai.total) * 100 : 0;
    if (!ai.providerConfigured) {
      out.push(card("PROVIDER_AVAILABILITY",
        "Aucun fournisseur IA n'est configuré sur cet environnement — les copilotes répondent en mode déterministe.",
        [{ label: "Fournisseur configuré", value: "non", href: DRILL.ai, section: "ai" }],
        "HIGH",
        "État de configuration lu localement — aucun appel au fournisseur n'est effectué par ce tableau de bord.",
        "Configurer un fournisseur IA dans les paramètres si l'assistance générative est souhaitée.",
        ["ai"], ts));
    } else if (ai.total > 0 && fallbackRate >= T.aiFallbackRatePct) {
      out.push(card("PROVIDER_AVAILABILITY",
        `${Math.round(fallbackRate)} % des requêtes IA ont basculé en repli déterministe sur ${ai.windowDays} jours.`,
        [
          { label: "Requêtes", value: String(ai.total), href: DRILL.ai, section: "ai" },
          { label: "Replis", value: String(ai.fallback), href: DRILL.ai, section: "ai" },
          ...(num(ai.avgDurationMs) ? [{ label: "Latence moyenne", value: `${ai.avgDurationMs} ms`, href: DRILL.ai, section: "ai" as ExecutiveSection }] : []),
        ],
        "HIGH",
        "Agrégats issus du journal d'audit des copilotes — un repli signifie que la réponse déterministe a été servie, jamais une réponse inventée.",
        "Vérifier la configuration et la disponibilité du fournisseur IA.",
        ["ai"], ts));
    }
  }

  return out;
}

/** Deterministic French executive summary — ALSO the provider-unavailable fallback answer. */
export function executiveDeterministicSummary(ctx: ExecutiveIntelligence, cards: ExecRecommendationCard[]): string {
  const lines: string[] = [];
  lines.push(`Synthèse exécutive déterministe (instantané du ${ctx.generatedAt.slice(0, 16).replace("T", " ")}).`);

  const shown = ctx.kpis.filter((k) => k.display != null);
  if (shown.length) lines.push(shown.map((k) => `${k.label} : ${k.display}`).join(" · ") + ".");

  const a = ctx.alertCounts;
  if (ctx.sections.includes("alerts")) {
    lines.push(`Alertes consolidées — critiques : ${a.critical} · élevées : ${a.high} · moyennes : ${a.medium} · faibles : ${a.low}.`);
  }

  if (cards.length === 0) lines.push("Aucun point d'attention exécutif dans les sections consultées.");
  else { lines.push(`${cards.length} point(s) d'attention :`); for (const c of cards) lines.push(`• ${c.title} — ${c.finding} (confiance ${c.confidence}).`); }

  lines.push(`Sections consultées : ${ctx.sections.length ? ctx.sections.join(", ") : "aucune"}.`);
  if (ctx.unavailable.length) lines.push(`Sections NON incluses (donnée manquante ≠ absence de problème) : ${ctx.unavailable.join(", ")}.`);
  if (ctx.map?.capped) lines.push(`Carte agrégée limitée aux ${ctx.map.cap} mouvements les plus récents par mode.`);
  return lines.join("\n");
}

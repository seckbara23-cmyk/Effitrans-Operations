/**
 * Customer AI Assistant — deterministic recommendation engine (Phase 7.6C). PURE.
 * ---------------------------------------------------------------------------
 * The CUSTOMER-SAFE sibling of lib/logistics/copilot/cards.ts, with the same guarantees:
 * cards are built from the bounded, owned context — NO model, NO fabrication — a card is emitted
 * ONLY when its section was consulted AND real records exist, and an unconsulted section produces
 * NO false "all-clear" (Missing ≠ Negative). This same output is the provider-down fallback, so
 * the panel still answers usefully when no AI provider is configured or reachable.
 *
 * Customer-safe by construction: only the 8 customer card kinds exist (no risk, no compliance, no
 * SLA, no internal queue), cards carry NO confidence/score, evidence cites only identifiers the
 * customer already knows, and every link points into /portal/*.
 */
import type {
  PortalCardKind,
  PortalCopilotContext,
  PortalEvidenceRecord,
  PortalRecommendationCard,
  PortalSection,
} from "./types";
import { PORTAL_CARD_TITLE } from "./types";

/** Requirement states that mean the customer still has to provide something. */
const CUSTOMER_OWED: string[] = ["requis", "a_remplacer"];
/** Requirement states that mean Effitrans is checking — no customer action. */
const UNDER_REVIEW: string[] = ["recu", "en_verification"];

function card(
  kind: PortalCardKind, finding: string, evidence: PortalEvidenceRecord[],
  reasoning: string, suggestedAction: string, sections: PortalSection[], timestamp: string,
): PortalRecommendationCard {
  return { kind, title: PORTAL_CARD_TITLE[kind], finding, evidence, reasoning, suggestedAction, sections, timestamp };
}

const has = (ctx: PortalCopilotContext, s: PortalSection) => ctx.sections.includes(s);

/** Build the deterministic customer cards from the assembled, owned context. */
export function buildPortalRecommendations(ctx: PortalCopilotContext): PortalRecommendationCard[] {
  const out: PortalRecommendationCard[] = [];
  const ts = ctx.generatedAt;
  const s = ctx.shipment;

  // Shipment progress — the grounded "where is my shipment" answer.
  if (s && has(ctx, "shipment")) {
    const ev: PortalEvidenceRecord[] = [
      { label: "Dossier", reference: s.fileNumber, detail: `${s.route} · ${s.progressPercent}% · ${s.currentLocation}`, link: s.link, section: "shipment", status: s.delay.label, timestamp: s.lastActivityAt },
    ];
    if (ctx.carriage) {
      const c = ctx.carriage;
      ev.push({
        label: c.transportLabel,
        reference: c.carrierOrVessel ?? c.voyageOrFlight,
        detail: [c.milestoneLabel, c.map.positionLabel ? `dernier point : ${c.map.positionLabel}` : null].filter(Boolean).join(" · ") || null,
        link: s.link,
        section: "transport",
        timestamp: c.map.positionAt,
      });
      for (const r of c.references) ev.push({ label: r.label, reference: r.value, link: s.link, section: "transport" });
    }
    out.push(card("SHIPMENT_PROGRESS",
      `${s.fileNumber} — ${s.route} : ${s.currentLocation} (${s.progressPercent} % du parcours, ${s.delay.label.toLowerCase()}).`,
      ev,
      s.delay.explanation ?? "Position et avancement calculés à partir des étapes réellement enregistrées sur votre dossier.",
      `Suivre l'avancement détaillé sur la page de votre expédition (${s.fileNumber}).`,
      ctx.carriage ? ["shipment", "transport"] : ["shipment"], ts));
  }

  // Upcoming arrival — only with a REAL dated ETA (never fabricated).
  if (s && s.eta.estimatedDate && !s.eta.delivered) {
    out.push(card("UPCOMING_ARRIVAL",
      `Arrivée estimée le ${s.eta.estimatedDate.slice(0, 10)}${s.eta.delayDays > 0 ? ` (${s.eta.delayDays} j après la date initialement estimée)` : ""}.`,
      [{ label: "Livraison estimée", reference: s.fileNumber, detail: s.eta.estimatedDate.slice(0, 10), link: s.link, section: "shipment", timestamp: s.eta.estimatedDate }],
      s.eta.basis === "operational_estimate"
        ? "Estimation prudente calculée à partir de la date réelle d'enlèvement — elle sera affinée dès qu'une date confirmée sera disponible."
        : "Date issue des informations de transport enregistrées sur votre dossier.",
      "Préparer la réception de votre marchandise et vérifier que vos documents sont complets.",
      ["shipment", "transport"], ts));
  }

  // Missing documents the CUSTOMER owes (distinct from documents under review).
  if (has(ctx, "documents")) {
    const owed = ctx.requirements.filter((r) => CUSTOMER_OWED.includes(r.state));
    if (owed.length > 0) {
      const ev = owed.map((r): PortalEvidenceRecord => ({
        label: r.label, reference: s?.fileNumber ?? null,
        detail: r.state === "a_remplacer" ? "à remplacer" : "à fournir",
        link: s?.link ?? "/portal/documents", section: "documents", status: r.state,
      }));
      out.push(card("MISSING_DOCUMENTS",
        `${owed.length} document(s) attendu(s) de votre part : ${owed.map((r) => r.label).join(", ")}.`,
        ev,
        "Ces documents sont requis pour votre type d'expédition et n'ont pas encore été validés.",
        "Téléverser les documents demandés depuis la page de votre expédition.",
        ["documents"], ts));
    }

    // Documents Effitrans is checking — reassurance, explicitly NOT a customer action.
    const reviewing = ctx.requirements.filter((r) => UNDER_REVIEW.includes(r.state));
    if (reviewing.length > 0) {
      out.push(card("DOCUMENT_REVIEW",
        `${reviewing.length} document(s) en cours de vérification par nos équipes.`,
        reviewing.map((r): PortalEvidenceRecord => ({ label: r.label, reference: s?.fileNumber ?? null, detail: "en vérification", link: s?.link ?? "/portal/documents", section: "documents", status: r.state })),
        "Ces documents ont bien été reçus ; leur vérification est en cours. Aucune action n'est attendue de votre part.",
        "Aucune action requise — vous serez informé du résultat de la vérification.",
        ["documents"], ts));
    }
  }

  // Customs — customer-safe state only (never a rejection or an inspection reason).
  if (ctx.customs && ctx.customs.state === "in_progress") {
    out.push(card("CUSTOMS_PROCESSING",
      `${ctx.customs.label} pour ${s?.fileNumber ?? "votre dossier"}.`,
      [{ label: "Douane", reference: s?.fileNumber ?? null, detail: ctx.customs.label, link: s?.link ?? null, section: "customs", status: ctx.customs.state }],
      "Le dossier est entre les mains des autorités douanières ; les délais de traitement dépendent d'elles.",
      "Aucune action requise pour l'instant — nos équipes suivent le dédouanement.",
      ["customs"], ts));
  }

  // Awaiting customer action — the next step explicitly assigned to the client.
  if (s && s.nextStep.party === "client" && s.nextStep.clientAction) {
    out.push(card("AWAITING_CUSTOMER_ACTION",
      `${s.nextStep.title} — une action est attendue de votre part.`,
      [{ label: s.nextStep.title, reference: s.fileNumber, detail: s.nextStep.clientAction, link: s.link, section: "shipment" }],
      s.nextStep.explanation,
      s.nextStep.clientAction,
      ["shipment", "documents"], ts));
  }

  // Invoices the customer can act on.
  if (has(ctx, "invoices")) {
    const payable = ctx.invoices.filter((i) => i.balance > 0);
    if (payable.length > 0) {
      const ev = payable.map((i): PortalEvidenceRecord => ({
        label: i.overdue ? "Facture échue" : "Facture",
        reference: i.invoiceNumber,
        detail: `solde ${i.balance} ${i.currency}${i.dueDate ? ` · échéance ${i.dueDate.slice(0, 10)}` : ""}`,
        link: i.link, section: "invoices", status: i.status, timestamp: i.dueDate,
      }));
      out.push(card("INVOICE_AVAILABLE",
        `${payable.length} facture(s) avec un solde à régler.`,
        ev,
        "Factures émises sur votre compte dont le solde n'est pas encore soldé.",
        "Consulter la facture et procéder au règlement depuis votre espace.",
        ["invoices"], ts));
    }
  }

  // Unread notifications — grounded pointer, never the message body.
  if (has(ctx, "notifications")) {
    const unread = ctx.notifications.filter((n) => !n.read);
    if (unread.length > 0) {
      out.push(card("NOTIFICATION_AVAILABLE",
        `${unread.length} information(s) non lue(s) concernant votre expédition.`,
        unread.map((n): PortalEvidenceRecord => ({ label: n.title, reference: null, detail: n.category, link: "/portal/notifications", section: "notifications", timestamp: n.createdAt })),
        "Des mises à jour ont été publiées sur votre espace depuis votre dernière consultation.",
        "Ouvrir vos notifications pour consulter le détail.",
        ["notifications"], ts));
    }
  }

  return out;
}

/** Deterministic French summary — ALSO the provider-unavailable fallback answer. */
export function portalDeterministicSummary(ctx: PortalCopilotContext, cards: PortalRecommendationCard[]): string {
  const lines: string[] = [];
  const s = ctx.shipment;
  lines.push(`Synthèse de votre expédition (informations arrêtées au ${ctx.generatedAt.slice(0, 16).replace("T", " ")}).`);

  if (s) {
    lines.push(`Dossier ${s.fileNumber} — ${s.route}. Étape actuelle : ${s.currentLocation} (${s.progressPercent} % du parcours). Statut : ${s.delay.label}.`);
    if (s.eta.estimatedDate) lines.push(`Livraison estimée : ${s.eta.estimatedDate.slice(0, 10)}.`);
    else lines.push("Livraison estimée : pas encore de date confirmée (aucune date n'est inventée).");
    if (ctx.carriage) {
      const c = ctx.carriage;
      lines.push(`${c.transportLabel}${c.carrierOrVessel ? ` — ${c.carrierOrVessel}` : ""}${c.milestoneLabel ? ` · ${c.milestoneLabel}` : ""}.`);
    }
    if (ctx.customs) lines.push(`Douane : ${ctx.customs.label}.`);
  } else if (ctx.portfolio.length > 0) {
    lines.push(`${ctx.portfolio.length} expédition(s) en cours :`);
    for (const p of ctx.portfolio.slice(0, 10)) lines.push(`• ${p.fileNumber} — ${p.route} (${p.percent} %, ${p.delayLabel}).`);
  }

  if (cards.length === 0) lines.push("Aucun point particulier à signaler dans les sections consultées.");
  else { lines.push(`${cards.length} point(s) à retenir :`); for (const c of cards) lines.push(`• ${c.title} — ${c.finding}`); }

  if (ctx.contact) lines.push(`Votre interlocuteur : ${ctx.contact.name} (${ctx.contact.title}).`);
  if (ctx.unavailable.length) lines.push(`Sections non incluses dans cette synthèse (information manquante ≠ absence de problème) : ${ctx.unavailable.join(", ")}.`);
  if (ctx.truncated.length) lines.push(`Liste tronquée pour : ${ctx.truncated.join(", ")}.`);
  return lines.join("\n");
}

/**
 * Copilot prompt builder (Phase 3.1A) — PURE (no I/O, no server imports).
 * ---------------------------------------------------------------------------
 * Serializes a `CopilotContext` snapshot into a compact, factual plain-text
 * brief and assembles the system + user messages for the model. Two hard rules
 * are encoded here and restated to the model:
 *
 *   1. The model answers ONLY from the provided brief. It never invents data.
 *      Sections marked "ACCÈS NON AUTORISÉ" are invisible to the current user —
 *      the model must not speculate about them.
 *   2. Output is PLAIN TEXT in French (Effitrans' operating language). No
 *      markdown tables, no invented figures, dates or references.
 *
 * Fully unit-tested. The serializer is deterministic and contains no secrets.
 */
import type { CopilotContext } from "@/lib/copilot/context";
import { skillPrompt, type CopilotSkill } from "@/lib/copilot/skills";

export type CopilotChatMessage = { role: "system" | "user"; content: string };

const NA = "Non renseigné";
const NO_ACCESS = "ACCÈS NON AUTORISÉ — l'utilisateur ne peut pas consulter cette section. Ne pas spéculer.";

const FRESHNESS_LABEL: Record<string, string> = {
  live: "en direct",
  recent: "récente",
  stale: "ancienne",
  none: "aucune",
};
const ETA_BASIS_LABEL: Record<string, string> = {
  scheduled: "date planifiée",
  transport_eta: "ETA transporteur",
  live_position: "position en direct",
  last_known_position: "dernière position connue",
  operational_estimate: "estimation opérationnelle",
  unavailable: "indisponible",
};
const EVENT_KIND_LABEL: Record<string, string> = {
  incident: "INCIDENT",
  delay: "RETARD",
  delivery: "LIVRAISON",
  operational: "Étape",
};

function val(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return NA;
  return String(v);
}

function line(label: string, v: string | number | null | undefined): string {
  return `- ${label} : ${val(v)}`;
}

/**
 * Render the context as a deterministic plain-text brief. Sections the caller
 * cannot read are explicitly labelled so the model knows the boundary.
 */
export function serializeContext(ctx: CopilotContext): string {
  const out: string[] = [];
  const d = ctx.dossier;

  out.push("=== DOSSIER ===");
  out.push(line("Numéro", d.fileNumber));
  out.push(line("Type", d.type));
  out.push(line("Statut", d.status));
  out.push(line("Priorité", d.priority));
  out.push(line("Client", d.clientName));
  out.push(line("Mode de transport", d.transportMode));
  out.push(line("Incoterm", d.incoterm));
  out.push(line("Origine", d.origin));
  out.push(line("Destination", d.destination));
  out.push(line("Nature marchandise", d.cargoType));
  out.push(line("Transporteur", d.carrierName));
  out.push(line("Navire/Vol", d.vesselOrFlight));
  out.push(line("Réf. BL/AWB", d.blAwbRef));
  out.push(line("Réf. conteneur", d.containerRef));
  out.push(line("Ouvert le", d.openedAt));

  const risk = ctx.risk;
  out.push("");
  out.push("=== RISQUE (moteur de risque — source de vérité) ===");
  out.push(line("Niveau", risk.level.toUpperCase()));
  out.push(line("Score", `${risk.score}/100`));
  out.push("Raisons :");
  if (risk.reasons.length > 0) for (const r of risk.reasons) out.push(`  - ${r}`);
  else out.push("  - Aucune");
  out.push("Actions recommandées :");
  if (risk.actions.length > 0) for (const a of risk.actions) out.push(`  - ${a}`);
  else out.push("  - Aucune");

  const lc = ctx.lifecycle;
  out.push("");
  out.push("=== CYCLE DE VIE ===");
  out.push(line("Avancement", `${lc.completedPercent}%`));
  out.push(line("Étape actuelle", lc.currentStep));
  out.push(line("Département actuel", lc.currentDepartment));
  out.push(line("Département suivant", lc.nextDepartment));
  if (lc.nextAction) {
    out.push(line("Prochaine action", `[${lc.nextAction.department}] ${lc.nextAction.action}`));
    if (lc.nextAction.blocker) out.push(line("Blocage", lc.nextAction.blocker));
  }
  if (lc.openHandoff) out.push(line("Passation en cours", lc.openHandoff));
  if (lc.blockers.length > 0) {
    out.push("Blocages actifs :");
    for (const b of lc.blockers) out.push(`  - ${b.label} : ${b.reason}`);
  }
  out.push("Étapes :");
  for (const st of lc.steps) out.push(`  - [${st.status}] ${st.label} (${st.department}) — ${st.description}`);

  out.push("");
  out.push("=== DOCUMENTS ===");
  if (!ctx.documents.included) {
    out.push(NO_ACCESS);
  } else {
    const doc = ctx.documents.data;
    out.push(line("Total", doc.total));
    out.push(line("Approuvés", doc.approved));
    out.push(line("En attente de revue", doc.pendingReview));
    out.push(line("Documents requis manquants", doc.missingRequired.length > 0 ? doc.missingRequired.join(", ") : "Aucun"));
    if (doc.items.length > 0) {
      out.push("Pièces :");
      for (const it of doc.items) {
        const expiry = it.expiry ? `, expire le ${it.expiry}` : "";
        const shared = it.sharedWithClient ? ", partagé client" : "";
        out.push(`  - ${it.type} : ${it.status}${expiry}${shared}`);
      }
    }
  }

  out.push("");
  out.push("=== DOUANE ===");
  if (!ctx.customs.included) {
    out.push(NO_ACCESS);
  } else if (!ctx.customs.data.present) {
    out.push("Aucun dossier douane.");
  } else {
    const c = ctx.customs.data;
    out.push(line("Statut", c.status));
    out.push(line("Requis", c.required === null ? null : c.required ? "Oui" : "Non"));
    out.push(line("N° déclaration", c.declarationNumber));
    out.push(line("Bureau de douane", c.customsOffice));
    out.push(line("Régime", c.regime));
    out.push(line("Référence BAE", c.baeReference));
    out.push(line("Inspection", c.inspectionStatus));
    out.push(line("Documents douane manquants", c.missingDocuments.length > 0 ? c.missingDocuments.join(", ") : "Aucun"));
  }

  out.push("");
  out.push("=== TRANSPORT ===");
  if (!ctx.transport.included) {
    out.push(NO_ACCESS);
  } else if (!ctx.transport.data.present) {
    out.push("Aucun dossier transport.");
  } else {
    const tr = ctx.transport.data;
    out.push(line("Statut", tr.status));
    out.push(line("Lieu d'enlèvement", tr.pickupLocation));
    out.push(line("Lieu de livraison", tr.deliveryLocation));
    out.push(line("Enlèvement prévu", tr.pickupPlanned));
    out.push(line("Livraison prévue", tr.deliveryPlanned));
    out.push(line("Livraison réelle", tr.deliveryActual));
    out.push(line("Chauffeur", tr.driverName));
    out.push(line("Transporteur", tr.transportCompany));
  }

  out.push("");
  out.push("=== SUIVI / CHRONOLOGIE ===");
  if (!ctx.tracking.included) {
    out.push(NO_ACCESS);
  } else if (!ctx.tracking.data.present) {
    out.push("Aucune donnée de suivi pour ce dossier.");
  } else {
    const tk = ctx.tracking.data;
    out.push(line("Chauffeur", tk.driverName));
    out.push(line("Dernière position connue", tk.latestPositionAt));
    out.push(line("Fraîcheur de la position", FRESHNESS_LABEL[tk.freshness] ?? tk.freshness));
    out.push(line("ETA estimée", tk.eta.estimatedArrival));
    out.push(line("Base de l'ETA", ETA_BASIS_LABEL[tk.eta.basis] ?? tk.eta.basis));
    out.push(line("Confiance ETA", `${tk.eta.confidence} (${tk.eta.confidencePercent}%)`));
    out.push(line("Livraison réelle", tk.deliveredAt));
    out.push(line("Incidents signalés", tk.incidents));
    out.push(line("Retards signalés", tk.delays));
    out.push(line("Événements vus par le client", tk.customerVisibleCount));
    if (tk.events.length > 0) {
      out.push("Chronologie (du plus récent au plus ancien) :");
      for (const e of tk.events) {
        const detail = e.internalNote || e.customerMessage;
        const suffix = detail ? ` — ${detail}` : "";
        out.push(`  - [${e.occurredAt}] ${EVENT_KIND_LABEL[e.kind] ?? e.kind} · ${e.type}${suffix}`);
      }
      if (tk.omittedEvents > 0) out.push(`  - (+${tk.omittedEvents} événement(s) plus ancien(s) omis)`);
    } else {
      out.push("Aucun événement de suivi enregistré.");
    }
  }

  out.push("");
  out.push("=== FINANCE ===");
  if (!ctx.finance.included) {
    out.push(NO_ACCESS);
  } else {
    const f = ctx.finance.data;
    out.push(line("Factures émises", f.hasIssued ? "Oui" : "Non"));
    out.push(line("Encours (solde dû)", f.outstanding));
    if (f.invoices.length > 0) {
      out.push("Factures :");
      for (const inv of f.invoices) {
        const od = inv.overdue ? ", EN RETARD" : "";
        const due = inv.dueDate ? `, échéance ${inv.dueDate}` : "";
        out.push(
          `  - ${val(inv.invoiceNumber)} : ${inv.status}, total ${inv.total} ${inv.currency}, réglé ${inv.paid}, solde ${inv.balance}${due}${od}`,
        );
      }
    } else {
      out.push("Aucune facture.");
    }
  }

  out.push("");
  out.push("=== SLA ===");
  if (!ctx.sla.included) {
    out.push("Aucune étape SLA active.");
  } else {
    const sla = ctx.sla.data;
    out.push(line("Statut SLA", sla.status));
    out.push(line("Département", sla.department));
    out.push(line("Étape", sla.stage));
    out.push(line("Ancienneté (jours)", sla.ageDays));
    if (sla.warningHours !== null) out.push(line("Seuil alerte (h)", sla.warningHours));
    if (sla.criticalHours !== null) out.push(line("Seuil critique (h)", sla.criticalHours));
  }

  out.push("");
  out.push("=== TÂCHES ===");
  if (!ctx.tasks.included) {
    out.push(NO_ACCESS);
  } else {
    const tk = ctx.tasks.data;
    out.push(line("Total", tk.total));
    out.push(line("Ouvertes", tk.open));
    if (tk.items.length > 0) {
      out.push("Tâches :");
      for (const it of tk.items) {
        const due = it.dueAt ? `, échéance ${it.dueAt}` : "";
        const who = it.assignedTo ? `, ${it.assignedTo}` : "";
        out.push(`  - ${it.title} : ${it.status} (${it.priority})${due}${who}`);
      }
    } else {
      out.push("Aucune tâche.");
    }
  }

  return out.join("\n");
}

/** Static system prompt — role, guardrails, output format. */
export function buildSystemPrompt(): string {
  return [
    "Tu es le Copilote des Opérations Effitrans, un assistant en lecture seule pour les agents de transit et de logistique à Dakar.",
    "Tu réponds en français, sur un ton professionnel, concis et opérationnel.",
    "",
    "RÈGLES STRICTES :",
    "- Réponds UNIQUEMENT à partir des informations du dossier fournies ci-dessous. N'invente jamais de données, de dates, de montants, de références ou de noms.",
    "- DISTINGUE explicitement trois cas : (1) information CONNUE (présente dans le dossier) ; (2) information INCONNUE (absente — dis clairement qu'elle n'est pas renseignée ou pas encore planifiée) ; (3) information NON AUTORISÉE (section « ACCÈS NON AUTORISÉ » — signale que tu n'y as pas accès). Ne comble jamais un vide par une supposition.",
    "- Une section marquée « ACCÈS NON AUTORISÉ » est invisible pour cet utilisateur : ne formule aucune hypothèse à son sujet et n'en déduis rien.",
    "- Tu es en LECTURE SEULE : tu ne peux ni modifier le dossier, ni créer de tâche, ni envoyer d'e-mail, ni exécuter d'action. Toute proposition d'action doit être introduite par « Action suggérée : » et rester une suggestion — ne prétends jamais l'avoir réalisée.",
    "- Réponds en texte brut. N'utilise PAS de tableaux markdown. Des listes à puces simples sont acceptées pour la lisibilité.",
    "- Pour une rédaction de message (mise à jour client, note de passation), produis un texte prêt à copier, fondé uniquement sur les faits du dossier. Un message CLIENT ne doit jamais contenir de note interne, de seuil SLA, d'incident interne ni de donnée d'une section non autorisée.",
    "- Pour toute question de CHRONOLOGIE (hier, aujourd'hui, depuis quand, ce qui a changé), appuie-toi sur la section « SUIVI / CHRONOLOGIE » et sur l'avancement du cycle de vie ; n'utilise que les dates réellement présentes.",
    "- Pour toute question sur les RISQUES, ce qui est préoccupant ou le dossier à traiter en priorité, appuie-toi sur la section « RISQUE » (issue du moteur de risque) : reprends son niveau, ses raisons et ses actions. Ne recalcule pas un score et n'invente pas de risques absents de cette section.",
    "- Cite tes sources par NOM DE SECTION (Documents, Douane, Transport, Suivi, Risque, Cycle de vie…), jamais par nom de champ technique.",
  ].join("\n");
}

export type CopilotHistoryTurn = { role: "user" | "assistant"; text: string };

const HISTORY_MAX_TURNS = 6;
const HISTORY_MAX_CHARS = 400;

/** Compact recap of recent turns so the model keeps context without a rebuild (D6). */
function renderHistory(history?: CopilotHistoryTurn[]): string {
  if (!history || history.length === 0) return "";
  const lines = ["HISTORIQUE DE LA CONVERSATION (contexte — ne pas répéter inutilement) :"];
  for (const h of history.slice(-HISTORY_MAX_TURNS)) {
    const who = h.role === "user" ? "Agent" : "Copilote";
    const txt = (h.text ?? "").replace(/\s+/g, " ").trim().slice(0, HISTORY_MAX_CHARS);
    if (txt) lines.push(`- ${who} : ${txt}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Assemble the model messages with prompt routing (D4): system prompt → skill
 * fragment (focused instruction) → optional conversation history (D6) + dossier
 * context + question. The skill is detected upstream (lib/copilot/skills).
 * Backward compatible — with no skill/history the behaviour matches the prior
 * single-prompt Copilot.
 */
export function buildMessages(
  ctx: CopilotContext,
  question: string,
  opts?: { skill?: CopilotSkill; english?: boolean; history?: CopilotHistoryTurn[] },
): CopilotChatMessage[] {
  const brief = serializeContext(ctx);
  const historyBlock = renderHistory(opts?.history);
  const user = [
    "CONTEXTE DU DOSSIER (source unique de vérité — ne rien inventer au-delà) :",
    "",
    brief,
    "",
    ...(historyBlock ? [historyBlock, ""] : []),
    "---",
    "",
    `QUESTION DE L'AGENT : ${question.trim()}`,
  ].join("\n");

  const messages: CopilotChatMessage[] = [{ role: "system", content: buildSystemPrompt() }];
  const fragment = opts?.skill ? skillPrompt(opts.skill, { english: opts.english }) : "";
  if (fragment) messages.push({ role: "system", content: fragment });
  messages.push({ role: "user", content: user });
  return messages;
}

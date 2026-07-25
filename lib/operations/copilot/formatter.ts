/**
 * Operations Copilot — serialization + deterministic briefing (Phase 10.0F). PURE.
 * ---------------------------------------------------------------------------
 * Emits ONLY the safe fields the bounded context already carries — never an id,
 * code, amount, href or contact value. `serializeOperationsContext` produces the
 * compact factual brief for the prompt; `deterministicBriefing` produces a
 * grounded French summary WITHOUT any model — the provider-down fallback and the
 * basis of the morning-briefing / priorities capabilities. Neither computes
 * business state; both only read the context.
 */
import { capSerialized } from "@/lib/copilot/budget";
import type { OperationsCopilotContext } from "./types";

const UNAVAILABLE = "Cette information n'est pas disponible actuellement.";

function block(title: string, lines: string[]): string[] {
  const kept = lines.filter(Boolean);
  return kept.length ? [`=== ${title} ===`, ...kept, ""] : [];
}
const num = (n: number | null | undefined): string => (n == null ? "n/d" : String(n));

/** Compact, budget-capped factual brief of the bounded snapshot (single source of truth). */
export function serializeOperationsContext(ctx: OperationsCopilotContext): string {
  const out: string[] = [];
  out.push("=== SYNTHÈSE OPÉRATIONNELLE (données bornées, lecture seule) ===");
  out.push(`Instantané : ${ctx.generatedAt} · axe : ${ctx.focus}`);
  out.push(`Sections incluses : ${ctx.sections.length ? ctx.sections.join(", ") : "aucune"}`);
  if (ctx.unavailable.length) out.push(`Sections NON incluses (donnée manquante ≠ absence de problème) : ${ctx.unavailable.join(", ")}`);
  if (ctx.alertSourcesDegraded) out.push("Attention : certaines sources d'alerte sont indisponibles — ne pas conclure « aucune alerte ».");
  out.push("");

  if (ctx.risk) out.push(...block("RISQUE", [`Dossiers nécessitant une intervention : ${ctx.risk.needingIntervention}`]));

  if (ctx.kpis.length) {
    out.push(...block("INDICATEURS", ctx.kpis.map((k) => `• ${k.label} (${k.window}) : ${k.display}`)));
  }

  if (ctx.alertCounts) {
    out.push(...block("ALERTES", [
      `Répartition : ${ctx.alertCounts.critical} critique(s) · ${ctx.alertCounts.high} élevé(s) · ${ctx.alertCounts.medium} moyen(s) · ${ctx.alertCounts.low} faible(s)`,
      ...ctx.alerts.map((a) => `• [${a.level}] ${a.reference ?? "—"} (${a.clientName ?? "—"}) : ${a.reason}`),
    ]));
  }

  if (ctx.operations) {
    const o = ctx.operations;
    out.push(...block("OPÉRATIONS", [
      `Dossiers actifs=${num(o.activeFiles)} · ouverts=${num(o.opened)} · en cours=${num(o.inProgress)} · livraisons en retard (ETA)=${num(o.overdueShipments)}`,
      `Tâches à traiter aujourd'hui=${num(o.tasksToday)} · en retard=${num(o.tasksOverdue)}`,
    ]));
  }

  if (ctx.transit) {
    const t = ctx.transit;
    out.push(...block("TRANSIT / DOUANE", [
      `Mouvements en cours=${num(t.movementsInProgress)} · arrivées≤7j=${num(t.arrivingWithin7Days)} · opérations en retard=${num(t.overdueOps)}`,
      `Douane en attente=${num(t.customsPending ?? t.awaitingCustoms)} · mainlevées=${num(t.customsReleased)}`,
    ]));
  }

  if (ctx.finance) {
    const f = ctx.finance;
    out.push(...block("FINANCE (volumes uniquement)", [
      `Demandes à examiner=${num(f.requestsPending)} · approuvées non décaissées=${num(f.approvedNotDisbursed)} · justificatifs dus=${num(f.evidenceOwed)}`,
      `Rapprochement en attente=${num(f.reconciliationPending)} · sans référence=${num(f.missingReference)} · créances en retard=${num(f.overdueReceivables)}`,
    ]));
  }

  if (ctx.workloadByDepartment.length || ctx.workloadByTeam.length) {
    out.push(...block("CHARGE DE TRAVAIL", [
      ...ctx.workloadByDepartment.map((d) => `• Département ${d.label} : ${d.open} tâche(s) ouverte(s)`),
      ...ctx.workloadByTeam.map((t) => `• Équipe ${t.label} : ${t.open} tâche(s) ouverte(s)`),
    ]));
  }

  if (ctx.messaging) {
    const m = ctx.messaging;
    out.push(...block("COMMUNICATIONS", [
      `Non lus=${num(m.unread)} · en attente de réponse=${num(m.waitingEffitrans)} · urgentes=${num(m.urgentOpen)}`,
    ]));
  }

  if (ctx.sections.length === 0) out.push(UNAVAILABLE);
  return capSerialized(out.join("\n").trim()).text;
}

/**
 * Deterministic French briefing — NO model. Honest about unavailable sections;
 * never fabricates. Used as the provider-down fallback and as the grounded basis
 * for the morning-briefing / priorities capabilities.
 */
export function deterministicBriefing(ctx: OperationsCopilotContext): string {
  const lines: string[] = ["Synthèse opérationnelle (générée sans IA — données bornées, lecture seule) :"];

  if (ctx.risk) lines.push(`• Dossiers nécessitant une intervention : ${ctx.risk.needingIntervention}.`);
  if (ctx.alertCounts) {
    const c = ctx.alertCounts;
    lines.push(`• Alertes : ${c.critical} critique(s), ${c.high} élevé(s), ${c.medium} moyen(s).${ctx.alertSourcesDegraded ? " Certaines sources sont indisponibles." : ""}`);
    for (const a of ctx.alerts.slice(0, 5)) lines.push(`   – [${a.level}] ${a.reference ?? "—"} (${a.clientName ?? "—"}) : ${a.reason}`);
  }
  if (ctx.operations) lines.push(`• Opérations : ${num(ctx.operations.activeFiles)} dossier(s) actif(s), ${num(ctx.operations.tasksOverdue)} tâche(s) en retard.`);
  if (ctx.transit) lines.push(`• Transit : ${num(ctx.transit.overdueOps)} opération(s) en retard, ${num(ctx.transit.customsPending ?? ctx.transit.awaitingCustoms)} en attente de douane.`);
  if (ctx.finance) lines.push(`• Finance : ${num(ctx.finance.requestsPending)} demande(s) à examiner, ${num(ctx.finance.overdueReceivables)} créance(s) en retard.`);
  if (ctx.workloadByDepartment.length) {
    const top = [...ctx.workloadByDepartment].sort((a, b) => b.open - a.open)[0];
    lines.push(`• Charge la plus élevée : ${top.label} (${top.open} tâche(s) ouverte(s)).`);
  }
  if (ctx.messaging) lines.push(`• Communications : ${num(ctx.messaging.urgentOpen)} conversation(s) urgente(s), ${num(ctx.messaging.waitingEffitrans)} en attente de réponse.`);

  const hasData = lines.length > 1; // any substantive line beyond the header
  if (ctx.unavailable.length) lines.push(`• Sections non incluses (non autorisées ou indisponibles) : ${ctx.unavailable.join(", ")}.`);
  if (!hasData) lines.push(UNAVAILABLE); // no data at all ⇒ the explicit unavailable statement, never a false all-clear
  lines.push(`Instantané généré le ${ctx.generatedAt.slice(0, 16).replace("T", " ")}.`);
  return lines.join("\n");
}

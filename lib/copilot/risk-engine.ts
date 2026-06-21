/**
 * AI Risk & Attention Engine (Phase 3.1B) — PURE (no I/O, no server imports).
 * ---------------------------------------------------------------------------
 * A DERIVED-ONLY visibility layer. It reads already-fetched signals (lifecycle,
 * SLA, documents, customs, transport, finance) and produces a Risk Level, Score,
 * Reasons and Recommended Actions. It writes NOTHING, changes no workflow state,
 * and is the SINGLE SOURCE OF TRUTH for risk scoring across the dossier page,
 * department workspaces, the Control Tower attention queue, the dashboard KPIs
 * and the Operations Copilot.
 *
 * Scoring model (additive, see Phase 3.1B spec):
 *   Documents : 1 missing +20 · 2+ missing +40
 *   SLA       : warning +15 · critical +35
 *   Customs   : under inspection +15 · inspection > 5 days +30
 *   Transport : awaiting POD +15 · transit exceeds SLA +25
 *   Finance   : invoice overdue +20 · overdue > 30 days +40
 * Level: 0–19 LOW · 20–49 MEDIUM · 50–79 HIGH · 80+ CRITICAL (score capped at 100).
 */
import type { CopilotContext } from "@/lib/copilot/context";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RiskSlaStatus = "normal" | "warning" | "critical" | "informational";

export type RiskInput = {
  lifecycle: { currentDepartment: string | null; nextAction: string | null } | null;
  sla: { status: RiskSlaStatus } | null;
  documents: { missingRequiredCount: number } | null;
  customs: { underInspection: boolean; inspectionDays: number | null } | null;
  transport: { awaitingPod: boolean; transitExceedsSla: boolean } | null;
  finance: { overdueCount: number; maxOverdueDays: number | null } | null;
};

export type RiskAssessment = {
  level: RiskLevel;
  score: number;
  reasons: string[];
  actions: string[];
};

// ---- scoring constants (the contract) ---------------------------------------
export const RISK_POINTS = {
  docMissingOne: 20,
  docMissingMany: 40,
  slaWarning: 15,
  slaCritical: 35,
  customsInspection: 15,
  customsInspectionLong: 30,
  transportAwaitingPod: 15,
  transportTransitOverSla: 25,
  financeOverdue: 20,
  financeOverdueLong: 40,
} as const;

export const INSPECTION_LONG_DAYS = 5;
export const OVERDUE_LONG_DAYS = 30;
const SCORE_CAP = 100;

// ---- reason / action copy (French — the operating language) -----------------
const REASON = {
  docsOne: "Un document requis est manquant.",
  docsMany: (n: number) => `${n} documents requis sont manquants.`,
  slaWarning: "Le délai SLA de l'étape courante est en alerte.",
  slaCritical: "Le délai SLA de l'étape courante est dépassé (critique).",
  inspection: "Le dossier est sous inspection douanière.",
  inspectionLong: (d: number) => `Inspection douanière prolongée (${d} jours).`,
  awaitingPod: "Livraison effectuée mais preuve de livraison (POD) en attente.",
  transitDelay: "Transport en transit au-delà du délai prévu.",
  overdue: (n: number) => `${n} facture(s) en retard de paiement.`,
  overdueLong: (n: number, d: number) => `${n} facture(s) en retard de plus de 30 jours (jusqu'à ${d} j).`,
  none: "Aucun risque détecté.",
} as const;

const ACTION = {
  docs: "Réclamer ou téléverser les documents requis manquants.",
  sla: "Traiter ce dossier en priorité pour rattraper le délai.",
  customs: "Relancer le bureau de douane au sujet de l'inspection.",
  pod: "Récupérer et téléverser la preuve de livraison (POD).",
  transit: "Contacter le transporteur pour accélérer la livraison.",
  finance: "Relancer le client pour le règlement des factures en retard.",
  nextPrefix: "Prochaine étape recommandée : ",
} as const;

export function riskLevel(score: number): RiskLevel {
  if (score >= 80) return "critical";
  if (score >= 50) return "high";
  if (score >= 20) return "medium";
  return "low";
}

/** Pure risk assessment. Deterministic; no I/O. */
export function assessRisk(input: RiskInput): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];
  const actions: string[] = [];

  // ---- documents (tiered)
  const missing = input.documents?.missingRequiredCount ?? 0;
  if (missing >= 2) {
    score += RISK_POINTS.docMissingMany;
    reasons.push(REASON.docsMany(missing));
    actions.push(ACTION.docs);
  } else if (missing === 1) {
    score += RISK_POINTS.docMissingOne;
    reasons.push(REASON.docsOne);
    actions.push(ACTION.docs);
  }

  // ---- SLA (tiered)
  if (input.sla?.status === "critical") {
    score += RISK_POINTS.slaCritical;
    reasons.push(REASON.slaCritical);
    actions.push(ACTION.sla);
  } else if (input.sla?.status === "warning") {
    score += RISK_POINTS.slaWarning;
    reasons.push(REASON.slaWarning);
    actions.push(ACTION.sla);
  }

  // ---- customs (tiered: long inspection supersedes plain inspection)
  if (input.customs?.underInspection) {
    const days = input.customs.inspectionDays;
    if (days != null && days > INSPECTION_LONG_DAYS) {
      score += RISK_POINTS.customsInspectionLong;
      reasons.push(REASON.inspectionLong(days));
    } else {
      score += RISK_POINTS.customsInspection;
      reasons.push(REASON.inspection);
    }
    actions.push(ACTION.customs);
  }

  // ---- transport (additive: distinct conditions)
  if (input.transport?.awaitingPod) {
    score += RISK_POINTS.transportAwaitingPod;
    reasons.push(REASON.awaitingPod);
    actions.push(ACTION.pod);
  }
  if (input.transport?.transitExceedsSla) {
    score += RISK_POINTS.transportTransitOverSla;
    reasons.push(REASON.transitDelay);
    actions.push(ACTION.transit);
  }

  // ---- finance (tiered: >30 days supersedes plain overdue)
  const overdueCount = input.finance?.overdueCount ?? 0;
  if (overdueCount > 0) {
    const od = input.finance?.maxOverdueDays ?? null;
    if (od != null && od > OVERDUE_LONG_DAYS) {
      score += RISK_POINTS.financeOverdueLong;
      reasons.push(REASON.overdueLong(overdueCount, od));
    } else {
      score += RISK_POINTS.financeOverdue;
      reasons.push(REASON.overdue(overdueCount));
    }
    actions.push(ACTION.finance);
  }

  const capped = Math.min(SCORE_CAP, score);
  const level = riskLevel(capped);

  if (reasons.length === 0) reasons.push(REASON.none);
  // Reinforce with the lifecycle's own next action when there IS a risk.
  if (level !== "low" && input.lifecycle?.nextAction) {
    actions.push(`${ACTION.nextPrefix}${input.lifecycle.nextAction}`);
  }

  return { level, score: capped, reasons, actions: Array.from(new Set(actions)) };
}

/** Days between a due date and `now` (0 when not yet due / unparseable). Pure. */
export function overdueDays(dueDate: string | null, now: Date): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return 0;
  return Math.max(0, Math.floor((now.getTime() - due) / 86_400_000));
}

// --------------------------------------------------------------------------- //
// Context adapter — derives RiskInput from the Copilot snapshot (single source //
// of truth). Permission-gated sections that are not visible contribute no risk //
// signal (they cannot, since their data is absent).                            //
// --------------------------------------------------------------------------- //

/** The subset of the Copilot context the risk engine reads. */
export type RiskContextView = Pick<
  CopilotContext,
  "lifecycle" | "sla" | "documents" | "customs" | "transport" | "finance"
>;

export function riskInputFromContext(ctx: RiskContextView, now: Date): RiskInput {
  const slaStatus = (ctx.sla.included ? ctx.sla.data.status : null) as RiskSlaStatus | null;

  const customs = ctx.customs.included
    ? {
        underInspection: ctx.customs.data.present && ctx.customs.data.status === "INSPECTION",
        inspectionDays:
          ctx.customs.data.present && ctx.customs.data.status === "INSPECTION" && ctx.sla.included
            ? ctx.sla.data.ageDays
            : null,
      }
    : null;

  const transport = ctx.transport.included
    ? {
        awaitingPod: ctx.transport.data.present && ctx.transport.data.status === "DELIVERED",
        transitExceedsSla:
          ctx.transport.data.present &&
          ctx.transport.data.status === "IN_TRANSIT" &&
          (slaStatus === "warning" || slaStatus === "critical"),
      }
    : null;

  const finance = ctx.finance.included
    ? (() => {
        const overdue = ctx.finance.data.invoices.filter((i) => i.overdue);
        const maxDays = overdue.reduce((m, i) => Math.max(m, overdueDays(i.dueDate, now)), 0);
        return { overdueCount: overdue.length, maxOverdueDays: maxDays || null };
      })()
    : null;

  return {
    lifecycle: {
      currentDepartment: ctx.lifecycle.currentDepartment,
      nextAction: ctx.lifecycle.nextAction?.action ?? null,
    },
    sla: slaStatus ? { status: slaStatus } : null,
    documents: { missingRequiredCount: ctx.documents.included ? ctx.documents.data.missingRequired.length : 0 },
    customs,
    transport,
    finance,
  };
}

// --------------------------------------------------------------------------- //
// Attention queue + KPIs — operate on per-dossier assessments (Control Tower). //
// --------------------------------------------------------------------------- //

export type DossierRiskRow = {
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  department: string | null;
  priority: string;
  ageDays: number;
  assessment: RiskAssessment;
};

export type AttentionRiskItem = {
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  department: string | null;
  level: RiskLevel;
  score: number;
  primaryReason: string;
  priority: string;
  ageDays: number;
};

export type RiskKpis = {
  critical: number;
  high: number;
  slaBreaches: number;
  overdueFinance: number | null;
};

const LEVEL_RANK: Record<RiskLevel, number> = { critical: 3, high: 2, medium: 1, low: 0 };
const PRIORITY_RANK: Record<string, number> = { critical: 3, high: 2, normal: 1, low: 0 };

/**
 * "Needs Immediate Attention" — high/critical dossiers ranked by:
 *   1. Critical  2. High  3. Dossier age  4. Existing priority.
 * Returns at most `limit` items (default 10).
 */
export function rankAttention(rows: DossierRiskRow[], limit = 10): AttentionRiskItem[] {
  return rows
    .filter((r) => r.assessment.level === "critical" || r.assessment.level === "high")
    .sort((a, b) => {
      const lvl = LEVEL_RANK[b.assessment.level] - LEVEL_RANK[a.assessment.level];
      if (lvl !== 0) return lvl;
      if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
      return (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
    })
    .slice(0, limit)
    .map((r) => ({
      fileId: r.fileId,
      fileNumber: r.fileNumber,
      clientName: r.clientName,
      department: r.department,
      level: r.assessment.level,
      score: r.assessment.score,
      primaryReason: r.assessment.reasons[0] ?? "",
      priority: r.priority,
      ageDays: r.ageDays,
    }));
}

/** Risk KPI counts. `slaBreaches` + `overdueFinance` come from existing aggregations. */
export function riskKpis(
  rows: DossierRiskRow[],
  slaBreaches: number,
  overdueFinance: number | null,
): RiskKpis {
  return {
    critical: rows.filter((r) => r.assessment.level === "critical").length,
    high: rows.filter((r) => r.assessment.level === "high").length,
    slaBreaches,
    overdueFinance,
  };
}

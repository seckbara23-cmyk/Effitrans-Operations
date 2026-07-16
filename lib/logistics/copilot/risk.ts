/**
 * Logistics Copilot — bounded portfolio-risk projection (Phase 7.6B, Parts 2-3). PURE.
 * ---------------------------------------------------------------------------
 * A PROJECTION over already-gathered bounded signals — NOT a new authoritative risk state. For
 * each file that appears in any bounded risk signal (customs block, delay, overdue invoice,
 * missing required doc) it assembles a RiskInput and reuses the EXISTING per-file risk engine
 * (assessRisk). It never invents a risk state and never treats missing data as low risk: only
 * files with a concrete risk signal are surfaced, each flagged `hasUnknown` because per-file SLA/
 * lifecycle are not evaluated at portfolio scope.
 */
import { assessRisk, type RiskInput } from "@/lib/copilot/risk-engine";
import type { CopilotAlert, CopilotDeclaration, CopilotInvoice, CopilotMissingDoc, CopilotRiskRow, LogisticsModule } from "./types";

export type RiskSignals = {
  attention: CopilotAlert[];
  blockedCustoms: CopilotDeclaration[];
  overdueInvoices: CopilotInvoice[];
  missingDocs: CopilotMissingDoc[];
};

const MODE_TO_MODULE: Record<string, LogisticsModule> = { road: "road", ocean: "ocean", air: "air", customs: "customs" };
const isDelay = (reason: string): boolean => /retard|obsol|exception|delay|stale/i.test(reason);
const isPod = (reason: string): boolean => /pod|preuve de livraison/i.test(reason);

type Bucket = { fileNumber: string; link: string; modes: Set<LogisticsModule>; alerts: CopilotAlert[]; blocked: CopilotDeclaration[]; overdue: CopilotInvoice[]; missing: CopilotMissingDoc[] };

/** Group all signals by file reference (file number). References that are null are skipped. */
function bucketByFile(s: RiskSignals): Map<string, Bucket> {
  const m = new Map<string, Bucket>();
  const get = (ref: string | null, link: string): Bucket | null => {
    if (!ref) return null;
    let b = m.get(ref);
    if (!b) { b = { fileNumber: ref, link, modes: new Set(), alerts: [], blocked: [], overdue: [], missing: [] }; m.set(ref, b); }
    return b;
  };
  for (const a of s.attention) { const b = get(a.reference, a.link); if (b) { b.alerts.push(a); const mod = MODE_TO_MODULE[a.mode]; if (mod) b.modes.add(mod); } }
  for (const d of s.blockedCustoms) { const b = get(d.fileNumber, d.link); if (b) { b.blocked.push(d); b.modes.add("customs"); } }
  for (const i of s.overdueInvoices) { const b = get(i.fileNumber, i.link); if (b) { b.overdue.push(i); b.modes.add("finance"); } }
  for (const d of s.missingDocs) { const b = get(d.fileNumber, d.link); if (b) { b.missing.push(d); b.modes.add("documents"); } }
  return m;
}

function toRiskInput(b: Bucket): RiskInput {
  const missingRequired = b.missing.filter((d) => d.state === "MISSING" || d.state === "EXPIRED").length;
  const underInspection = b.blocked.length > 0; // any blocked/inspection declaration is a customs risk
  const overdue = b.overdue.length;
  const maxOverdueDays = b.overdue.reduce((mx, i) => Math.max(mx, i.daysOverdue), 0) || null;
  const awaitingPod = b.alerts.some((a) => a.mode === "road" && isPod(a.reason));
  const transitDelay = b.alerts.some((a) => (a.mode === "ocean" || a.mode === "air" || a.mode === "road") && isDelay(a.reason));
  return {
    lifecycle: null,
    sla: null, // not evaluated at portfolio scope → hasUnknown
    documents: { missingRequiredCount: missingRequired },
    customs: underInspection ? { underInspection: true, inspectionDays: null } : null,
    transport: awaitingPod || transitDelay ? { awaitingPod, transitExceedsSla: transitDelay } : null,
    finance: overdue > 0 ? { overdueCount: overdue, maxOverdueDays } : null,
  };
}

/** Build ranked portfolio-risk rows (highest score first), capped at `limit`. */
export function assemblePortfolioRisk(signals: RiskSignals, limit: number): CopilotRiskRow[] {
  const rows: CopilotRiskRow[] = [];
  for (const b of bucketByFile(signals).values()) {
    const assessment = assessRisk(toRiskInput(b));
    if (assessment.score === 0) continue; // no concrete signal → not surfaced (not "low risk")
    rows.push({
      fileNumber: b.fileNumber,
      fileId: "",
      level: assessment.level,
      score: assessment.score,
      contributors: assessment.reasons,
      modes: Array.from(b.modes),
      ageDays: null,
      latestEvent: b.alerts[0]?.reason ?? b.blocked[0]?.status ?? null,
      link: b.link,
      hasUnknown: true, // per-file SLA/lifecycle not evaluated at portfolio scope
    });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

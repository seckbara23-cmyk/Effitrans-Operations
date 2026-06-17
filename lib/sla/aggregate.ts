/**
 * SLA aggregation (Phase 2.3) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Aggregates per-dossier SLA rows into department counts, the delayed queue, the
 * bottleneck ranking, and simple average-duration KPIs. Reuses the SLA
 * classifier output — no duplicate lifecycle logic.
 */
import type { SlaDept } from "./config";
import type { SlaStatus } from "./classify";

export type SlaRow = {
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  department: SlaDept | null;
  stage: string | null;
  sla: SlaStatus;
  ageHours: number;
  daysWaiting: number;
  nextAction: string;
  priority: string;
  fileStatus: string;
};

export type SlaCounts = { normal: number; warning: number; critical: number };
export type DeptKey = "documentation" | "customs" | "transport" | "finance";
const DEPTS: DeptKey[] = ["documentation", "customs", "transport", "finance"];

export function emptyCounts(): SlaCounts {
  return { normal: 0, warning: 0, critical: 0 };
}

function tally(c: SlaCounts, sla: SlaStatus): void {
  if (sla === "critical") c.critical += 1;
  else if (sla === "warning") c.warning += 1;
  else if (sla === "normal") c.normal += 1;
}

export function slaCountsByDept(rows: SlaRow[]): Record<DeptKey, SlaCounts> {
  const out: Record<DeptKey, SlaCounts> = {
    documentation: emptyCounts(),
    customs: emptyCounts(),
    transport: emptyCounts(),
    finance: emptyCounts(),
  };
  for (const r of rows) {
    if (r.fileStatus === "CLOSED") continue;
    if (r.department && r.department !== "archive") tally(out[r.department], r.sla);
  }
  return out;
}

/** Department-scoped summary from already-classified rows (department workspaces). */
export function slaSummary(rows: { sla: SlaStatus }[]): SlaCounts {
  const c = emptyCounts();
  for (const r of rows) tally(c, r.sla);
  return c;
}

const SEVERITY: Record<SlaStatus, number> = { critical: 3, warning: 2, informational: 1, normal: 0 };

/** Delayed dossiers: warning/critical only, critical first, then longest waiting. Top N. */
export function delayedDossiers(rows: SlaRow[], limit = 20): SlaRow[] {
  return rows
    .filter((r) => r.fileStatus !== "CLOSED" && (r.sla === "warning" || r.sla === "critical"))
    .sort((a, b) => SEVERITY[b.sla] - SEVERITY[a.sla] || b.ageHours - a.ageHours)
    .slice(0, limit);
}

export type BottleneckRank = { department: DeptKey; critical: number; warning: number };

/** Top operational bottlenecks: departments ranked by critical then warning. */
export function bottleneckRanking(rows: SlaRow[]): BottleneckRank[] {
  const counts = slaCountsByDept(rows);
  return DEPTS.map((d) => ({ department: d, critical: counts[d].critical, warning: counts[d].warning }))
    .filter((b) => b.critical > 0 || b.warning > 0)
    .sort((a, b) => b.critical - a.critical || b.warning - a.warning);
}

/** Mean duration in days over (start,end) pairs; null when no usable data (N/A). */
export function averageDays(pairs: { start: string | null; end: string | null }[]): number | null {
  let sum = 0;
  let n = 0;
  for (const p of pairs) {
    if (!p.start || !p.end) continue;
    const s = new Date(p.start).getTime();
    const e = new Date(p.end).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) continue;
    sum += (e - s) / 86_400_000;
    n += 1;
  }
  return n ? Math.round((sum / n) * 10) / 10 : null;
}

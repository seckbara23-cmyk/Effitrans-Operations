/**
 * Operations Copilot — context builder (Phase 10.0F). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * THE one authoritative context builder. It composes — ONCE, request-cache()d —
 * the EXISTING permission-shaped composed readers:
 *   getOperationsKpis()      (10.0D executive KPI engine)
 *   getOperationalAlerts()   (10.0E unified alert center)
 *   getOperationsCockpit()   (10.0B composition layer: operations/transit/finance/messaging/workload)
 * and projects them into a bounded, REDACTED snapshot. It owns NO business rule,
 * runs NO query of its own, and adds NO calculation — every figure was produced
 * by an authoritative reader.
 *
 * PERMISSION: gated on the EXISTING `logistics:copilot:read` (the platform's
 * operational-AI-access permission, shared with the sibling Logistics Copilot) —
 * NO new permission is introduced. Beyond that gate the context is shaped by the
 * SOURCE permissions each composed reader already enforces: a viewer without
 * analytics:read gets no KPIs, without finance:read no finance counts, etc. The
 * copilot can therefore never receive data the viewer could not already access.
 *
 * REDACTION: only counts, statuses, safe labels and file-number references cross
 * into the context — never a KPI key, alert code, entityId/UUID, href, monetary
 * amount, payment reference or contact value.
 */
import "server-only";
import { cache } from "react";
import { assertPermission } from "@/lib/auth/require-permission";
import { getOperationsKpis } from "@/lib/operations/kpi/reader";
import { getOperationalAlerts } from "@/lib/operations/alerts/reader";
import { getOperationsCockpit } from "@/lib/operations/reader";
import { classifyOperationsQuestion } from "./tools";
import type {
  CopilotAlert, CopilotKpi, CopilotWorkloadRow, OperationsCopilotContext,
} from "./types";

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

const WINDOW_LABEL: Record<string, string> = {
  current: "actuel",
  today: "aujourd'hui",
  month_to_date: "mois en cours",
};

const ALERT_CAP = 25;
const WORKLOAD_CAP = 12;

export const buildOperationsContext = cache(async (question = ""): Promise<OperationsCopilotContext> => {
  // Copilot-access gate (existing permission — throws → 403 at any future route).
  await assertPermission("logistics:copilot:read");
  const focus = classifyOperationsQuestion(question);
  const generatedAt = new Date().toISOString();

  const [kpiR, alertR, cockpitR] = await Promise.allSettled([
    getOperationsKpis(),
    getOperationalAlerts(),
    getOperationsCockpit(),
  ]);
  const kpiSet = settled(kpiR);
  const alertSet = settled(alertR);
  const cockpit = settled(cockpitR);

  const sections: string[] = [];
  const unavailable: string[] = [];

  // ---- KPIs (analytics:read via the engine) — count/rate/duration only, amounts dropped ----
  let kpis: CopilotKpi[] = [];
  let risk: OperationsCopilotContext["risk"] = null;
  if (kpiSet) {
    kpis = kpiSet.kpis
      .filter((k) => k.kind !== "amount" && k.status !== "unavailable" && k.value != null)
      .map((k): CopilotKpi => ({
        label: k.label,
        display: k.unit === "days" ? `${k.value} j` : k.unit === "percent" ? `${k.value} %` : String(k.value),
        window: WINDOW_LABEL[k.window.key] ?? k.window.key,
        status: k.status,
      }));
    const intervention = kpiSet.kpis.find((k) => k.key === "dossiers_intervention");
    if (intervention?.value != null) risk = { needingIntervention: intervention.value };
    sections.push("kpis");
  } else {
    unavailable.push("kpis");
  }

  // ---- Alerts (unified, per-source permission-shaped) ----
  const alerts: CopilotAlert[] = (alertSet?.alerts ?? [])
    .slice(0, ALERT_CAP)
    .map((a): CopilotAlert => ({ level: a.level, reason: a.reason, reference: a.reference, clientName: a.clientName }));
  const alertCounts = alertSet ? alertSet.counts : null;
  const alertSourcesDegraded = alertSet ? alertSet.sources.some((s) => s.status === "unavailable") : false;
  if (alertSet && alertSet.sources.some((s) => s.status === "ok")) sections.push("alerts");
  else unavailable.push("alerts");

  // ---- Operations / Transit / Finance / Messaging / Workload (composition layer) ----
  const ops = cockpit?.operations ?? null;
  const operations = ops
    ? {
        activeFiles: ops.files?.active ?? null,
        opened: ops.files?.opened ?? null,
        inProgress: ops.files?.inProgress ?? null,
        overdueShipments: ops.files?.overdueShipments ?? null,
        tasksToday: ops.tasks?.dueToday ?? null,
        tasksOverdue: ops.tasks?.overdue ?? null,
      }
    : null;
  (operations ? sections : unavailable).push("operations");

  const tr = cockpit?.transit ?? null;
  const transit = tr
    ? {
        movementsInProgress: tr.headline?.movementsInProgress ?? null,
        arrivingWithin7Days: tr.headline?.arrivingWithin7Days ?? null,
        overdueOps: tr.headline?.overdueOps ?? null,
        awaitingCustoms: tr.customs?.pending ?? tr.headline?.awaitingCustoms ?? null,
        customsPending: tr.customs?.pending ?? null,
        customsReleased: tr.customs?.released ?? null,
      }
    : null;
  (transit ? sections : unavailable).push("transit");

  const fin = cockpit?.finance ?? null;
  const finance = fin
    ? {
        requestsPending: fin.requests?.pendingReview ?? null,
        approvedNotDisbursed: fin.requests?.approvedNotDisbursed ?? null,
        evidenceOwed: fin.requests ? fin.requests.evidenceMissing + fin.requests.evidenceToVerify : null,
        reconciliationPending: fin.reconciliation?.pending ?? null,
        missingReference: fin.reconciliation?.missingReference ?? null,
        overdueReceivables: fin.invoices?.overdueCount ?? null,
      }
    : null;
  (finance ? sections : unavailable).push("finance");

  const msg = cockpit?.messaging ?? null;
  const messaging = msg
    ? { unread: msg.unread, waitingEffitrans: msg.summary?.waitingEffitrans ?? null, urgentOpen: msg.summary?.urgentOpen ?? null }
    : null;
  (messaging ? sections : unavailable).push("messaging");

  // Department/team workload only — named per-person workload is deliberately NOT exposed to the AI.
  const wl = cockpit?.workload ?? null;
  const workloadByDepartment: CopilotWorkloadRow[] = (wl?.byDepartment ?? [])
    .slice(0, WORKLOAD_CAP)
    .map((d) => ({ label: d.labelFr, open: d.open }));
  const workloadByTeam: CopilotWorkloadRow[] = (wl?.byTeam ?? [])
    .slice(0, WORKLOAD_CAP)
    .map((t) => ({ label: t.labelFr, open: t.open }));
  if (wl) sections.push("workload");
  else unavailable.push("workload");

  return {
    generatedAt,
    focus,
    sections,
    unavailable,
    kpis,
    alerts,
    alertCounts,
    alertSourcesDegraded,
    risk,
    operations,
    transit,
    finance,
    workloadByDepartment,
    workloadByTeam,
    messaging,
    counts: { kpis: kpis.length, alerts: alerts.length, workloadDepartments: workloadByDepartment.length },
  };
});

/**
 * Operations control-tower aggregation (Phase 2.2) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Buckets per-dossier lifecycle results (from the EXISTING getDossierLifecycle)
 * into the dashboard's funnel, flow nodes, aging, bottlenecks and needs-attention
 * queue. No new status logic — everything derives from DossierLifecycle. Fully
 * unit-tested. `now` is injected.
 */
import type { DossierLifecycle, Department } from "@/lib/files/lifecycle";
import { isActiveFileStatus, isFileStatus } from "@/lib/files/status";

export type FunnelStage =
  | "draft"
  | "documents"
  | "customs"
  | "transport"
  | "delivered"
  | "invoiced"
  | "paid"
  | "archived";

export type DossierLifecycleRow = {
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  priority: string;
  fileStatus: string;
  createdAt: string;
  overdueInvoice: boolean;
  lifecycle: DossierLifecycle;
};

export function ageDays(createdAt: string, now: Date): number {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** Map a dossier's current lifecycle position to one funnel stage. */
export function funnelStage(currentStep: string | null, fileStatus: string): FunnelStage {
  if (fileStatus === "CLOSED") return "archived";
  if (!currentStep) return "archived";
  if (currentStep === "draft" || currentStep === "quote_approved") return "draft";
  if (currentStep.startsWith("documents_")) return "documents";
  if (currentStep.startsWith("customs_") || currentStep === "release_authorized") return "customs";
  if (currentStep === "transport_planned" || currentStep === "in_transit" || currentStep === "delivered") return "transport";
  if (currentStep === "invoiced") return "delivered"; // transport done, awaiting invoicing
  if (currentStep === "paid") return "invoiced"; // invoiced, awaiting payment
  if (currentStep === "archived") return "paid"; // paid, awaiting archive
  return "archived";
}

export const FUNNEL_ORDER: FunnelStage[] = [
  "draft",
  "documents",
  "customs",
  "transport",
  "delivered",
  "invoiced",
  "paid",
  "archived",
];

export function funnelCounts(rows: DossierLifecycleRow[]): Record<FunnelStage, number> {
  const out = Object.fromEntries(FUNNEL_ORDER.map((s) => [s, 0])) as Record<FunnelStage, number>;
  for (const r of rows) out[funnelStage(r.lifecycle.currentStep, r.fileStatus)] += 1;
  return out;
}

export type FlowNode = "documentation" | "customs" | "transport" | "finance" | "archive";
export const FLOW_ORDER: FlowNode[] = ["documentation", "customs", "transport", "finance", "archive"];

export function flowCounts(rows: DossierLifecycleRow[]): Record<FlowNode, number> {
  const out = Object.fromEntries(FLOW_ORDER.map((n) => [n, 0])) as Record<FlowNode, number>;
  for (const r of rows) {
    if (r.fileStatus === "CLOSED") {
      out.archive += 1;
      continue;
    }
    const dept = r.lifecycle.currentDepartment as Department | null;
    if (dept === "documentation" || dept === "customs" || dept === "transport" || dept === "finance" || dept === "archive") {
      out[dept] += 1;
    }
    // "opening" (draft) dossiers are not on the operational flow.
  }
  return out;
}

export type AgingBuckets = { b0_2: number; b3_5: number; b6_10: number; b10p: number };

export function agingBuckets(rows: DossierLifecycleRow[], now: Date): AgingBuckets {
  const out: AgingBuckets = { b0_2: 0, b3_5: 0, b6_10: 0, b10p: 0 };
  for (const r of rows) {
    // DEC-B43 — active dossiers only (terminal CLOSED/CANCELLED excluded).
    if (isFileStatus(r.fileStatus) && !isActiveFileStatus(r.fileStatus)) continue;
    const d = ageDays(r.createdAt, now);
    if (d <= 2) out.b0_2 += 1;
    else if (d <= 5) out.b3_5 += 1;
    else if (d <= 10) out.b6_10 += 1;
    else out.b10p += 1;
  }
  return out;
}

export type Bottleneck = { key: string; label: string; count: number };

export function bottlenecks(rows: DossierLifecycleRow[]): Bottleneck[] {
  const docsBlocked = rows.filter((r) => r.lifecycle.blockers.some((b) => b.key === "documents_collection")).length;
  const customsInspection = rows.filter((r) => r.lifecycle.currentStep === "customs_inspection").length;
  const awaitingPod = rows.filter(
    (r) => r.lifecycle.currentStep === "invoiced" && r.lifecycle.nextAction?.reasonCode === "await_pod",
  ).length;
  const overdue = rows.filter((r) => r.overdueInvoice).length;
  return [
    { key: "docs_blocked", label: "Dossiers bloqués par la documentation", count: docsBlocked },
    { key: "customs_inspection", label: "Dossiers en inspection douanière", count: customsInspection },
    { key: "awaiting_pod", label: "Livraisons en attente de POD", count: awaitingPod },
    { key: "overdue_invoices", label: "Factures en retard", count: overdue },
  ].filter((b) => b.count > 0);
}

export type AttentionItem = {
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  department: Department | null;
  reason: string;
  daysWaiting: number;
  nextAction: string;
  priority: string;
};

export type TransportTimeRow = { pickupActual: string | null; deliveryActual: string | null };

/** Delivered-this-month + average delivery duration (days), derived from transport actuals. */
export function transportTimeKpis(
  rows: TransportTimeRow[],
  now: Date,
): { deliveredThisMonth: number; avgDeliveryDays: number | null } {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let delivered = 0;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.deliveryActual) continue;
    const dt = new Date(r.deliveryActual).getTime();
    if (Number.isNaN(dt)) continue;
    if (dt >= monthStart) delivered += 1;
    if (r.pickupActual) {
      const pu = new Date(r.pickupActual).getTime();
      if (!Number.isNaN(pu) && dt >= pu) {
        sum += (dt - pu) / 86_400_000;
        n += 1;
      }
    }
  }
  return { deliveredThisMonth: delivered, avgDeliveryDays: n ? Math.round((sum / n) * 10) / 10 : null };
}

const WAITING_REASONS = new Set([
  "docs_missing",
  "docs_pending_review",
  "docs_must_verify",
  "await_customs_release",
  "await_customs_response",
  "await_pod",
  "await_payment",
  "customs_blocked",
  "transport_blocked",
]);

const PRIORITY_RANK: Record<string, number> = { critical: 3, high: 2, normal: 1, low: 0 };

export function needsAttention(rows: DossierLifecycleRow[], now: Date, limit = 10): AttentionItem[] {
  const candidates = rows.filter((r) => {
    // DEC-B43 — a terminal dossier (CLOSED/CANCELLED) never needs attention.
    if ((isFileStatus(r.fileStatus) && !isActiveFileStatus(r.fileStatus)) || !r.lifecycle.currentStep) return false;
    const blocked = r.lifecycle.blockers.length > 0;
    const waiting = r.lifecycle.nextAction != null && WAITING_REASONS.has(r.lifecycle.nextAction.reasonCode);
    const urgent = r.priority === "high" || r.priority === "critical";
    return blocked || waiting || urgent || r.overdueInvoice;
  });

  return candidates
    .map((r) => {
      const na = r.lifecycle.nextAction;
      const blocker = r.lifecycle.blockers[0]?.reason;
      return {
        fileId: r.fileId,
        fileNumber: r.fileNumber,
        clientName: r.clientName,
        department: r.lifecycle.currentDepartment,
        reason: blocker ?? na?.action ?? "",
        daysWaiting: ageDays(r.createdAt, now),
        nextAction: na?.action ?? "",
        priority: r.priority,
      };
    })
    .sort((a, b) => {
      const pr = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
      return pr !== 0 ? pr : b.daysWaiting - a.daysWaiting;
    })
    .slice(0, limit);
}

/**
 * Operations control-tower data (Phase 2.2 + 2.3 SLA). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Gated by analytics:read (management view), service-role admin client + tenant
 * scope — the same crossing-domains pattern as getAnalytics. Loads the raw rows
 * ONCE and runs the EXISTING getDossierLifecycle per dossier; Phase 2.3 adds
 * derived SLA (stage duration + classification) in the same pass — no new
 * schema, no stored values, no duplicate lifecycle logic. Finance data is loaded
 * only when the viewer holds finance:read.
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/rbac/check";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { isActiveFileStatus, isFileStatus } from "@/lib/files/status";
import { invoiceTotals, paidAmount, balanceDue, isOverdue } from "@/lib/finance/calc";
import { getAnalytics } from "@/lib/analytics/service";
import { stageDuration } from "@/lib/sla/stage-duration";
import { classifySla, toSlaDept } from "@/lib/sla/classify";
import {
  slaCountsByDept,
  delayedDossiers,
  bottleneckRanking,
  averageDays,
  type SlaRow,
  type SlaCounts,
  type DeptKey,
  type BottleneckRank,
} from "@/lib/sla/aggregate";
import {
  funnelCounts,
  flowCounts,
  agingBuckets,
  bottlenecks,
  needsAttention,
  transportTimeKpis,
  ageDays,
  type DossierLifecycleRow,
  type FunnelStage,
  type FlowNode,
  type AgingBuckets,
  type Bottleneck,
  type AttentionItem,
} from "./aggregate";
import {
  assessRisk,
  rankAttention,
  riskKpis as computeRiskKpis,
  overdueDays,
  type RiskInput,
  type DossierRiskRow,
  type AttentionRiskItem,
  type RiskKpis,
} from "@/lib/copilot/risk-engine";

export type ExecutiveKpis = {
  activeDossiers: number;
  deliveredThisMonth: number;
  revenueThisMonth: number | null;
  outstanding: number | null;
  avgCustomsDays: number | null;
  avgDeliveryDays: number | null;
  currency: string;
};

export type AverageTimes = {
  documentationDays: number | null;
  customsDays: number | null;
  transportDays: number | null;
  timeToInvoiceDays: number | null;
  timeToPaymentDays: number | null;
};

export type ControlTowerData = {
  funnel: Record<FunnelStage, number>;
  flow: Record<FlowNode, number>;
  aging: AgingBuckets;
  bottlenecks: Bottleneck[];
  needsAttention: AttentionItem[];
  kpis: ExecutiveKpis;
  // Phase 2.3 SLA
  slaByDept: Record<DeptKey, SlaCounts>;
  delayed: SlaRow[];
  slaRanking: BottleneckRank[];
  avgTimes: AverageTimes;
  canFinance: boolean;
  // Phase 3.1B — derived risk (no stored values).
  attentionQueue: AttentionRiskItem[];
  riskKpis: RiskKpis;
  // Phase 3.0B — opt-in per-dossier export rows (Power BI / reporting). Populated
  // ONLY when getControlTower is called with { includeDossiers: true } so the
  // dashboard payload is unchanged. Surfaced from the SAME single pass — never a
  // second aggregation.
  dossiers?: DossierExportRow[];
};

/** One normalized per-dossier row for the Power BI Shipments / Risk datasets. */
export type DossierExportRow = {
  fileNumber: string | null;
  clientName: string | null;
  type: string;
  priority: string;
  fileStatus: string;
  currentDepartment: string | null;
  lifecycleStage: string | null;
  riskLevel: string;
  riskScore: number;
  slaStatus: string;
  daysOpen: number;
  customsStatus: string | null;
  transportStatus: string | null;
  paymentStatus: string;
  outstanding: number | null;
};

// Phase 10.0B — request-level cache(): /dashboard, /reports and the cockpit composition
// share ONE lifecycle pass per render (same memoization as getAnalytics; the permissions
// array is the cache()'d getEffectivePermissions reference, so keys are stable per request).
export const getControlTower = cache(async (
  permissions: string[],
  opts: { includeDossiers?: boolean } = {},
): Promise<ControlTowerData> => {
  const user = await assertPermission("analytics:read");
  const canFinance = hasPermission(permissions, "finance:read");
  const supabase = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const now = new Date();
  const dossierRows: DossierExportRow[] = [];

  const [filesRes, docsRes, typesRes, customsRes, transportRes, analytics] = await Promise.all([
    supabase
      .from("operational_file")
      .select("id, file_number, type, status, priority, created_at, opened_at, updated_at, client:client_id(name)")
      .eq("tenant_id", tenant)
      .limit(2000)
      .returns<
        { id: string; file_number: string | null; type: string; status: string; priority: string; created_at: string; opened_at: string | null; updated_at: string; client: { name: string } | null }[]
      >(),
    supabase.from("document").select("file_id, type_code, status").eq("tenant_id", tenant).is("deleted_at", null).returns<{ file_id: string; type_code: string; status: string }[]>(),
    supabase.from("document_type").select("code, required_for").eq("active", true).returns<{ code: string; required_for: string[] | null }[]>(),
    supabase.from("customs_record").select("file_id, status, required, updated_at, declaration_date, release_date").eq("tenant_id", tenant).is("deleted_at", null).returns<{ file_id: string; status: string; required: boolean; updated_at: string; declaration_date: string | null; release_date: string | null }[]>(),
    supabase.from("transport_record").select("file_id, status, updated_at, pickup_actual, delivery_actual").eq("tenant_id", tenant).is("deleted_at", null).returns<{ file_id: string; status: string; updated_at: string; pickup_actual: string | null; delivery_actual: string | null }[]>(),
    getAnalytics(canFinance).catch(() => null),
  ]);

  const files = filesRes.data ?? [];
  const docs = docsRes.data ?? [];
  const types = typesRes.data ?? [];
  const customs = customsRes.data ?? [];
  const transport = transportRes.data ?? [];

  // Finance (only with finance:read): per-file balances/overdue + invoice timestamps + payments.
  const overdueByFile = new Map<string, boolean>();
  const overdueDaysByFile = new Map<string, number>();
  const invoicesByFile = new Map<string, { status: string; balance: number }[]>();
  const invoiceUpdatedByFile = new Map<string, string>();
  const invoiceIssueByFile = new Map<string, string>();
  const paymentPairs: { start: string | null; end: string | null }[] = [];
  if (canFinance) {
    const [invRes, lineRes, payRes] = await Promise.all([
      supabase.from("invoice").select("id, file_id, status, due_date, issue_date, updated_at").eq("tenant_id", tenant).returns<{ id: string; file_id: string; status: string; due_date: string | null; issue_date: string | null; updated_at: string }[]>(),
      supabase.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate").eq("tenant_id", tenant).returns<{ invoice_id: string; quantity: number; unit_amount: number; tax_rate: number }[]>(),
      supabase.from("payment").select("invoice_id, amount, reversed_at, paid_at").eq("tenant_id", tenant).returns<{ invoice_id: string; amount: number; reversed_at: string | null; paid_at: string }[]>(),
    ]);
    const linesByInv = new Map<string, { quantity: number; unitAmount: number; taxRate: number }[]>();
    for (const l of lineRes.data ?? []) {
      const arr = linesByInv.get(l.invoice_id) ?? [];
      arr.push({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) });
      linesByInv.set(l.invoice_id, arr);
    }
    const paysByInv = new Map<string, { amount: number; reversed: boolean }[]>();
    for (const p of payRes.data ?? []) {
      const arr = paysByInv.get(p.invoice_id) ?? [];
      arr.push({ amount: Number(p.amount), reversed: p.reversed_at != null });
      paysByInv.set(p.invoice_id, arr);
    }
    const issueByInvoice = new Map<string, string | null>();
    for (const inv of invRes.data ?? []) {
      issueByInvoice.set(inv.id, inv.issue_date);
      const { total } = invoiceTotals(linesByInv.get(inv.id) ?? []);
      const balance = balanceDue(total, paidAmount(paysByInv.get(inv.id) ?? []));
      const arr = invoicesByFile.get(inv.file_id) ?? [];
      arr.push({ status: inv.status, balance });
      invoicesByFile.set(inv.file_id, arr);
      if (isOverdue(inv.status as never, inv.due_date, balance, now)) {
        overdueByFile.set(inv.file_id, true);
        const d = overdueDays(inv.due_date, now);
        if (d > (overdueDaysByFile.get(inv.file_id) ?? 0)) overdueDaysByFile.set(inv.file_id, d);
      }
      const prev = invoiceUpdatedByFile.get(inv.file_id);
      if (!prev || inv.updated_at > prev) invoiceUpdatedByFile.set(inv.file_id, inv.updated_at);
      if (inv.issue_date && !invoiceIssueByFile.has(inv.file_id)) invoiceIssueByFile.set(inv.file_id, inv.issue_date);
    }
    for (const p of payRes.data ?? []) {
      if (p.reversed_at != null) continue;
      paymentPairs.push({ start: issueByInvoice.get(p.invoice_id) ?? null, end: p.paid_at });
    }
  }

  // Per-file lookups.
  const docsByFile = new Map<string, { typeCode: string; status: string }[]>();
  const podByFile = new Set<string>();
  for (const d of docs) {
    const arr = docsByFile.get(d.file_id) ?? [];
    arr.push({ typeCode: d.type_code, status: d.status });
    docsByFile.set(d.file_id, arr);
    if (d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED") podByFile.add(d.file_id);
  }
  const requiredFor = (fileType: string) => types.filter((t) => (t.required_for ?? []).includes(fileType)).map((t) => t.code);
  const customsByFile = new Map(customs.map((c) => [c.file_id, c]));
  const transportByFile = new Map(transport.map((tr) => [tr.file_id, tr]));

  const rows: DossierLifecycleRow[] = [];
  const slaRows: SlaRow[] = [];
  const riskRows: DossierRiskRow[] = [];

  for (const f of files) {
    const fileDocs = docsByFile.get(f.id) ?? [];
    const approved = new Set(fileDocs.filter((d) => d.status === "APPROVED").map((d) => d.typeCode));
    const missingRequired = requiredFor(f.type).filter((code) => !approved.has(code)).map((code) => ({ label: code }));
    const cust = customsByFile.get(f.id);
    const tr = transportByFile.get(f.id);
    const lifecycle = getDossierLifecycle({
      fileId: f.id,
      file: { status: f.status, type: f.type },
      documents: fileDocs.map((d) => ({ status: d.status })),
      missingRequired,
      customs: cust ? { status: cust.status, required: cust.required } : null,
      transport: tr ? { status: tr.status } : null,
      invoices: invoicesByFile.get(f.id) ?? [],
      podApproved: podByFile.has(f.id),
    });

    rows.push({
      fileId: f.id,
      fileNumber: f.file_number,
      clientName: f.client?.name ?? null,
      priority: f.priority,
      fileStatus: f.status,
      createdAt: f.created_at,
      overdueInvoice: overdueByFile.get(f.id) ?? false,
      lifecycle,
    });

    // DEC-B43 (10.0D-1) — SLA and risk describe ACTIVE work only. Terminal dossiers
    // (CLOSED was already neutralized via the archive department mapping; CANCELLED
    // previously leaked in as live work) never enter the SLA/risk/attention rows.
    // Funnel/flow rows above and the export rows below deliberately see every status;
    // a terminal dossier exports with no live risk (score 0) and no applicable SLA.
    let exportRisk: { level: string; score: number } = { level: "low", score: 0 };
    let exportSlaStatus = "informational";
    if (!isFileStatus(f.status) || isActiveFileStatus(f.status)) {
      // Phase 2.3 — derived stage duration + SLA status (no stored values).
      const sd = stageDuration({
        now,
        currentDepartment: lifecycle.currentDepartment,
        currentStage: lifecycle.currentStep,
        fileCreatedAt: f.created_at,
        fileOpenedAt: f.opened_at,
        fileUpdatedAt: f.updated_at,
        customsUpdatedAt: cust?.updated_at ?? null,
        transportUpdatedAt: tr?.updated_at ?? null,
        invoiceUpdatedAt: invoiceUpdatedByFile.get(f.id) ?? null,
      });
      const slaStatus = classifySla(lifecycle.currentDepartment, sd.ageHours);
      slaRows.push({
        fileId: f.id,
        fileNumber: f.file_number,
        clientName: f.client?.name ?? null,
        department: toSlaDept(lifecycle.currentDepartment),
        stage: lifecycle.currentStep,
        sla: slaStatus,
        ageHours: sd.ageHours,
        daysWaiting: ageDays(f.created_at, now),
        nextAction: lifecycle.nextAction?.action ?? "",
        priority: f.priority,
        fileStatus: f.status,
      });

      // Phase 3.1B — derived per-dossier risk (reuses this same lifecycle/SLA pass).
      const inspecting = lifecycle.currentStep === "customs_inspection";
      const awaitingPod = lifecycle.currentStep === "invoiced" && lifecycle.nextAction?.reasonCode === "await_pod";
      const riskInput: RiskInput = {
        lifecycle: { currentDepartment: lifecycle.currentDepartment, nextAction: lifecycle.nextAction?.action ?? null },
        sla: { status: slaStatus },
        documents: { missingRequiredCount: missingRequired.length },
        customs: cust ? { underInspection: inspecting, inspectionDays: inspecting ? Math.floor(sd.ageHours / 24) : null } : null,
        transport: tr
          ? { awaitingPod, transitExceedsSla: lifecycle.currentStep === "in_transit" && (slaStatus === "warning" || slaStatus === "critical") }
          : null,
        finance: canFinance
          ? { overdueCount: overdueByFile.get(f.id) ? 1 : 0, maxOverdueDays: overdueDaysByFile.get(f.id) ?? null }
          : null,
      };
      const assessment = assessRisk(riskInput);
      riskRows.push({
        fileId: f.id,
        fileNumber: f.file_number,
        clientName: f.client?.name ?? null,
        department: lifecycle.currentDepartment,
        priority: f.priority,
        ageDays: ageDays(f.created_at, now),
        assessment,
      });
      exportRisk = { level: assessment.level, score: assessment.score };
      exportSlaStatus = slaStatus;
    }

    // Phase 3.0B — normalized per-dossier export row (same pass, opt-in only).
    if (opts.includeDossiers) {
      const fileInvoices = invoicesByFile.get(f.id) ?? [];
      const outstanding = canFinance
        ? fileInvoices.reduce((s, inv) => s + (inv.balance > 0 ? inv.balance : 0), 0)
        : null;
      const paymentStatus = !canFinance
        ? "—"
        : overdueByFile.get(f.id)
          ? "Overdue"
          : fileInvoices.length
            ? "Current"
            : "None";
      dossierRows.push({
        fileNumber: f.file_number,
        clientName: f.client?.name ?? null,
        type: f.type,
        priority: f.priority,
        fileStatus: f.status,
        currentDepartment: lifecycle.currentDepartment,
        lifecycleStage: lifecycle.currentStep,
        riskLevel: exportRisk.level,
        riskScore: exportRisk.score,
        slaStatus: exportSlaStatus,
        daysOpen: ageDays(f.created_at, now),
        customsStatus: cust?.status ?? null,
        transportStatus: tr?.status ?? null,
        paymentStatus,
        outstanding,
      });
    }
  }

  const tt = transportTimeKpis(transport.map((tr) => ({ pickupActual: tr.pickup_actual, deliveryActual: tr.delivery_actual })), now);

  const avgCustoms = averageDays(customs.map((c) => ({ start: c.declaration_date, end: c.release_date })));
  const avgTransport = averageDays(transport.map((tr) => ({ start: tr.pickup_actual, end: tr.delivery_actual })));
  const timeToInvoice = canFinance
    ? averageDays(files.map((f) => ({ start: transportByFile.get(f.id)?.delivery_actual ?? null, end: invoiceIssueByFile.get(f.id) ?? null })))
    : null;
  const timeToPayment = canFinance ? averageDays(paymentPairs) : null;

  const kpis: ExecutiveKpis = {
    // DEC-B43 — analytics is the primary source; the fallback uses THE same canonical
    // predicate (DRAFT is active; CLOSED/CANCELLED are not) so both paths agree.
    activeDossiers:
      analytics?.operations.active ??
      rows.filter((r) => !isFileStatus(r.fileStatus) || isActiveFileStatus(r.fileStatus)).length,
    deliveredThisMonth: tt.deliveredThisMonth,
    revenueThisMonth: analytics?.financial?.revenueThisMonth ?? null,
    outstanding: analytics?.financial?.outstanding ?? null,
    avgCustomsDays: analytics?.customs.avgReleaseDays ?? avgCustoms,
    avgDeliveryDays: tt.avgDeliveryDays,
    currency: analytics?.currency ?? "XOF",
  };

  const sla = slaCountsByDept(slaRows);
  if (!canFinance) sla.finance = { normal: 0, warning: 0, critical: 0 };

  // Phase 3.1B — attention queue + risk KPIs from the per-dossier assessments.
  const slaBreaches = slaRows.filter((r) => r.sla === "critical").length;
  const overdueFinance = canFinance ? overdueByFile.size : null;

  return {
    funnel: funnelCounts(rows),
    flow: flowCounts(rows),
    aging: agingBuckets(rows, now),
    bottlenecks: bottlenecks(rows),
    needsAttention: needsAttention(rows, now),
    kpis,
    slaByDept: sla,
    delayed: delayedDossiers(slaRows),
    slaRanking: bottleneckRanking(slaRows).filter((b) => canFinance || b.department !== "finance"),
    avgTimes: {
      documentationDays: null, // no reliable "documents verified" timestamp — N/A (documented)
      customsDays: avgCustoms,
      transportDays: avgTransport,
      timeToInvoiceDays: timeToInvoice,
      timeToPaymentDays: timeToPayment,
    },
    canFinance,
    attentionQueue: rankAttention(riskRows, 10),
    riskKpis: computeRiskKpis(riskRows, slaBreaches, overdueFinance),
    ...(opts.includeDossiers ? { dossiers: dossierRows } : {}),
  };
});

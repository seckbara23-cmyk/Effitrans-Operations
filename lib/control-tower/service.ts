/**
 * Operations control-tower data (Phase 2.2). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Gated by analytics:read (management view), service-role admin client + tenant
 * scope — the same crossing-domains pattern as getAnalytics. Loads the raw rows
 * ONCE (operational_file / document / customs_record / transport_record /
 * invoice + lines + payments), assembles per-dossier inputs, and runs the
 * EXISTING getDossierLifecycle per dossier — no duplicated lifecycle logic, no
 * new schema. Finance data is loaded only when the viewer holds finance:read.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/rbac/check";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { invoiceTotals, paidAmount, balanceDue, isOverdue } from "@/lib/finance/calc";
import { getAnalytics } from "@/lib/analytics/service";
import {
  funnelCounts,
  flowCounts,
  agingBuckets,
  bottlenecks,
  needsAttention,
  transportTimeKpis,
  type DossierLifecycleRow,
  type FunnelStage,
  type FlowNode,
  type AgingBuckets,
  type Bottleneck,
  type AttentionItem,
} from "./aggregate";

export type ExecutiveKpis = {
  activeDossiers: number;
  deliveredThisMonth: number;
  revenueThisMonth: number | null;
  outstanding: number | null;
  avgCustomsDays: number | null;
  avgDeliveryDays: number | null;
  currency: string;
};

export type ControlTowerData = {
  funnel: Record<FunnelStage, number>;
  flow: Record<FlowNode, number>;
  aging: AgingBuckets;
  bottlenecks: Bottleneck[];
  needsAttention: AttentionItem[];
  kpis: ExecutiveKpis;
};

export async function getControlTower(permissions: string[]): Promise<ControlTowerData> {
  const user = await assertPermission("analytics:read");
  const canFinance = hasPermission(permissions, "finance:read");
  const supabase = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const now = new Date();

  const [filesRes, docsRes, typesRes, customsRes, transportRes, analytics] = await Promise.all([
    supabase
      .from("operational_file")
      .select("id, file_number, type, status, priority, created_at, client:client_id(name)")
      .eq("tenant_id", tenant)
      .limit(2000)
      .returns<
        { id: string; file_number: string | null; type: string; status: string; priority: string; created_at: string; client: { name: string } | null }[]
      >(),
    supabase
      .from("document")
      .select("file_id, type_code, status")
      .eq("tenant_id", tenant)
      .is("deleted_at", null)
      .returns<{ file_id: string; type_code: string; status: string }[]>(),
    supabase
      .from("document_type")
      .select("code, required_for")
      .eq("active", true)
      .returns<{ code: string; required_for: string[] | null }[]>(),
    supabase
      .from("customs_record")
      .select("file_id, status, required")
      .eq("tenant_id", tenant)
      .is("deleted_at", null)
      .returns<{ file_id: string; status: string; required: boolean }[]>(),
    supabase
      .from("transport_record")
      .select("file_id, status, pickup_actual, delivery_actual")
      .eq("tenant_id", tenant)
      .is("deleted_at", null)
      .returns<{ file_id: string; status: string; pickup_actual: string | null; delivery_actual: string | null }[]>(),
    getAnalytics(canFinance).catch(() => null),
  ]);

  const files = filesRes.data ?? [];
  const docs = docsRes.data ?? [];
  const types = typesRes.data ?? [];
  const customs = customsRes.data ?? [];
  const transport = transportRes.data ?? [];

  // Finance (only with finance:read): invoices + lines + payments -> per-file balances/overdue.
  const overdueByFile = new Map<string, boolean>();
  const invoicesByFile = new Map<string, { status: string; balance: number }[]>();
  if (canFinance) {
    const [invRes, lineRes, payRes] = await Promise.all([
      supabase.from("invoice").select("id, file_id, status, due_date").eq("tenant_id", tenant).returns<{ id: string; file_id: string; status: string; due_date: string | null }[]>(),
      supabase.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate").eq("tenant_id", tenant).returns<{ invoice_id: string; quantity: number; unit_amount: number; tax_rate: number }[]>(),
      supabase.from("payment").select("invoice_id, amount, reversed_at").eq("tenant_id", tenant).returns<{ invoice_id: string; amount: number; reversed_at: string | null }[]>(),
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
    for (const inv of invRes.data ?? []) {
      const { total } = invoiceTotals(linesByInv.get(inv.id) ?? []);
      const balance = balanceDue(total, paidAmount(paysByInv.get(inv.id) ?? []));
      const arr = invoicesByFile.get(inv.file_id) ?? [];
      arr.push({ status: inv.status, balance });
      invoicesByFile.set(inv.file_id, arr);
      if (isOverdue(inv.status as never, inv.due_date, balance, now)) overdueByFile.set(inv.file_id, true);
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
  const customsByFile = new Map(customs.map((c) => [c.file_id, { status: c.status, required: c.required }]));
  const transportByFile = new Map(transport.map((tr) => [tr.file_id, { status: tr.status }]));

  // Assemble per-dossier lifecycle rows (reusing getDossierLifecycle).
  const rows: DossierLifecycleRow[] = files.map((f) => {
    const fileDocs = docsByFile.get(f.id) ?? [];
    const approved = new Set(fileDocs.filter((d) => d.status === "APPROVED").map((d) => d.typeCode));
    const missingRequired = requiredFor(f.type)
      .filter((code) => !approved.has(code))
      .map((code) => ({ label: code }));
    const lifecycle = getDossierLifecycle({
      fileId: f.id,
      file: { status: f.status, type: f.type },
      documents: fileDocs.map((d) => ({ status: d.status })),
      missingRequired,
      customs: customsByFile.get(f.id) ?? null,
      transport: transportByFile.get(f.id) ?? null,
      invoices: invoicesByFile.get(f.id) ?? [],
      podApproved: podByFile.has(f.id),
    });
    return {
      fileId: f.id,
      fileNumber: f.file_number,
      clientName: f.client?.name ?? null,
      priority: f.priority,
      fileStatus: f.status,
      createdAt: f.created_at,
      overdueInvoice: overdueByFile.get(f.id) ?? false,
      lifecycle,
    };
  });

  const tt = transportTimeKpis(
    transport.map((tr) => ({ pickupActual: tr.pickup_actual, deliveryActual: tr.delivery_actual })),
    now,
  );

  const kpis: ExecutiveKpis = {
    activeDossiers: analytics?.operations.active ?? rows.filter((r) => r.fileStatus !== "CLOSED" && r.fileStatus !== "DRAFT").length,
    deliveredThisMonth: tt.deliveredThisMonth,
    revenueThisMonth: analytics?.financial?.revenueThisMonth ?? null,
    outstanding: analytics?.financial?.outstanding ?? null,
    avgCustomsDays: analytics?.customs.avgReleaseDays ?? null,
    avgDeliveryDays: tt.avgDeliveryDays,
    currency: analytics?.currency ?? "XOF",
  };

  return {
    funnel: funnelCounts(rows),
    flow: flowCounts(rows),
    aging: agingBuckets(rows, now),
    bottlenecks: bottlenecks(rows),
    needsAttention: needsAttention(rows, now),
    kpis,
  };
}

/**
 * Portal shipment progress (Phase 2.4). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Single source of truth: reuses the internal getDossierLifecycle, then maps it
 * to the customer-facing timeline (lib/portal/progress-map). Ownership is
 * verified through the RLS user-context client (the portal user must already be
 * able to see the dossier); the full lifecycle inputs are then read with the
 * admin client PURELY to compute the customer-safe timeline — only the mapped
 * stages / percent / activity are returned, never internal data. No RLS change.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentPortalUser } from "./auth";
import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { invoiceTotals, paidAmount, balanceDue } from "@/lib/finance/calc";
import { assessRisk, overdueDays, type RiskInput } from "@/lib/copilot/risk-engine";
import { toPortalTimeline, portalActivity, type PortalTimeline, type PortalStageKey } from "./progress-map";
import { toPortalRisk, deriveEta, type PortalRiskLevel, type PortalEta } from "./shipment-view";

export type PortalProgress = {
  timeline: PortalTimeline;
  activity: PortalStageKey[];
  lastUpdate: string | null;
  podAvailable: boolean;
  // Phase 3.3 — derived, customer-safe views (reuse the Risk Engine + ETA helper).
  risk: PortalRiskLevel;
  eta: PortalEta;
  currentDepartment: string | null;
};

export async function getPortalProgress(fileId: string): Promise<PortalProgress | null> {
  const user = await getCurrentPortalUser();
  if (!user) return null;

  // Ownership via RLS: a portal user only resolves their own client's dossier.
  const ctx = getServerSupabaseClient();
  const { data: own } = await ctx
    .from("operational_file")
    .select("id, status, type, updated_at")
    .eq("id", fileId)
    .maybeSingle<{ id: string; status: string; type: string; updated_at: string }>();
  if (!own) return null;

  // Ownership confirmed — read full inputs (admin) only to derive the timeline.
  const admin = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const [docsRes, typesRes, customsRes, transportRes, invRes] = await Promise.all([
    admin.from("document").select("type_code, status, shared_with_client").eq("tenant_id", tenant).eq("file_id", fileId).is("deleted_at", null).returns<{ type_code: string; status: string; shared_with_client: boolean }[]>(),
    admin.from("document_type").select("code, required_for").eq("active", true).returns<{ code: string; required_for: string[] | null }[]>(),
    admin.from("customs_record").select("status, required, updated_at").eq("tenant_id", tenant).eq("file_id", fileId).is("deleted_at", null).maybeSingle<{ status: string; required: boolean; updated_at: string }>(),
    admin.from("transport_record").select("status, updated_at, delivery_planned, delivery_actual").eq("tenant_id", tenant).eq("file_id", fileId).is("deleted_at", null).maybeSingle<{ status: string; updated_at: string; delivery_planned: string | null; delivery_actual: string | null }>(),
    admin.from("invoice").select("id, status, due_date, updated_at").eq("tenant_id", tenant).eq("file_id", fileId).returns<{ id: string; status: string; due_date: string | null; updated_at: string }[]>(),
  ]);

  const docs = docsRes.data ?? [];
  const approved = new Set(docs.filter((d) => d.status === "APPROVED").map((d) => d.type_code));
  const missingRequired = (typesRes.data ?? [])
    .filter((t) => (t.required_for ?? []).includes(own.type) && !approved.has(t.code))
    .map((t) => ({ label: t.code }));
  const podApproved = docs.some((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED");

  // Invoice balances for the lifecycle (no amounts exposed in the timeline).
  const invoices: { status: string; balance: number; dueDate: string | null }[] = [];
  const invIds = (invRes.data ?? []).map((i) => i.id);
  if (invIds.length) {
    const [lineRes, payRes] = await Promise.all([
      admin.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate").eq("tenant_id", tenant).in("invoice_id", invIds).returns<{ invoice_id: string; quantity: number; unit_amount: number; tax_rate: number }[]>(),
      admin.from("payment").select("invoice_id, amount, reversed_at").eq("tenant_id", tenant).in("invoice_id", invIds).returns<{ invoice_id: string; amount: number; reversed_at: string | null }[]>(),
    ]);
    for (const inv of invRes.data ?? []) {
      const lines = (lineRes.data ?? []).filter((l) => l.invoice_id === inv.id).map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) }));
      const pays = (payRes.data ?? []).filter((p) => p.invoice_id === inv.id).map((p) => ({ amount: Number(p.amount), reversed: p.reversed_at != null }));
      invoices.push({ status: inv.status, balance: balanceDue(invoiceTotals(lines).total, paidAmount(pays)), dueDate: inv.due_date });
    }
  }

  const lifecycle = getDossierLifecycle({
    fileId,
    file: { status: own.status, type: own.type },
    documents: docs.map((d) => ({ status: d.status })),
    missingRequired,
    customs: customsRes.data ? { status: customsRes.data.status, required: customsRes.data.required } : null,
    transport: transportRes.data ? { status: transportRes.data.status } : null,
    invoices,
    podApproved,
  });

  const timeline = toPortalTimeline(lifecycle.steps);
  const podAvailable = docs.some((d) => d.type_code === "DELIVERY_NOTE" && d.status === "APPROVED" && d.shared_with_client);
  const lastUpdate = [own.updated_at, customsRes.data?.updated_at, transportRes.data?.updated_at, ...(invRes.data ?? []).map((i) => i.updated_at)]
    .filter((x): x is string => Boolean(x))
    .sort()
    .pop() ?? null;

  // Phase 3.3 — derived risk (reuse the Risk Engine) + ETA (reuse the helper).
  const now = new Date();
  const overdue = invoices.filter(
    (i) => (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") && i.balance > 0 && i.dueDate != null && new Date(i.dueDate).getTime() < now.getTime(),
  );
  const maxOverdue = overdue.reduce((m, i) => Math.max(m, overdueDays(i.dueDate, now)), 0);
  const riskInput: RiskInput = {
    lifecycle: { currentDepartment: lifecycle.currentDepartment, nextAction: lifecycle.nextAction?.action ?? null },
    sla: null,
    documents: { missingRequiredCount: missingRequired.length },
    customs: customsRes.data ? { underInspection: customsRes.data.status === "INSPECTION", inspectionDays: null } : null,
    transport: transportRes.data ? { awaitingPod: transportRes.data.status === "DELIVERED" && !podApproved, transitExceedsSla: false } : null,
    finance: invoices.length ? { overdueCount: overdue.length, maxOverdueDays: maxOverdue || null } : null,
  };
  const risk = toPortalRisk(assessRisk(riskInput).level);
  const eta = deriveEta({
    deliveryPlanned: transportRes.data?.delivery_planned ?? null,
    deliveryActual: transportRes.data?.delivery_actual ?? null,
    delivered: timeline.stages.find((s) => s.key === "delivered")?.status === "completed",
    lastUpdate,
    now,
  });

  return {
    timeline,
    activity: portalActivity(timeline),
    lastUpdate,
    podAvailable,
    risk,
    eta,
    currentDepartment: lifecycle.currentDepartment,
  };
}

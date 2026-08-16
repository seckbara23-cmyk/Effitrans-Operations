"use server";

/**
 * HR-7A/7C — payroll preparation actions. SERVER ACTIONS. FACTS ONLY.
 * ---------------------------------------------------------------------------
 * Every consequential act goes through migration 20260901000001's RPCs, which
 * verify the actor (HR630) and assert authority IN THE DATABASE (INV-7):
 *   create / prepare / verify / reopen / cancel / adjustments → hr:manage
 *   approve / lock → the PARKED hr:payroll:approve (denies everyone until
 *     Effitrans ratifies the seats — Q7; the actions still exist so the
 *     activation is one grant, the hr:leave:approve playbook)
 * The adjustment vocabulary is tenant configuration (hr:config:manage), ships
 * empty, and no category is ever invented here. Nothing stores money (Q1).
 * Audits record THAT something happened plus safe counts — never per-person
 * facts; the per-employee ledger events are emitted by the RPCs themselves.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getCurrentUser } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit/log";

export type PayrollResult = { ok: true; id?: string; count?: number } | { ok: false; error: string; detail?: string };

const RPC_ERRORS: Record<string, string> = {
  HR630: "actor_invalid",
  HR701: "period_immutable", HR702: "period_not_found", HR703: "duplicate_period",
  HR704: "invalid_period", HR705: "lines_frozen", HR706: "wrong_status",
  HR707: "same_actor_approve", HR708: "kind_invalid", HR709: "invalid_quantity",
  HR710: "adjustment_not_found", HR711: "same_actor_decide", HR712: "adjustment_immutable",
  HR713: "employee_not_in_period", HR714: "empty_period", HR715: "reason_required",
};
const mapRpc = (e: { code?: string; message?: string } | null) => ({
  error: (e?.code && RPC_ERRORS[e.code])
    || (e?.code?.startsWith("EFA") ? "forbidden_payroll" : "save_failed"),
  detail: e?.message,
});

const PATH = "/departments/hr/paie";

async function actor(): Promise<{ id: string; tenantId: string } | null> {
  const user = await getCurrentUser();
  return user ? { id: user.id, tenantId: user.tenantId } : null;
}

export async function createPayrollPeriod(input: {
  code: string; labelFr: string; periodStart: string; periodEnd: string;
}): Promise<PayrollResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "forbidden" };
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_create_payroll_period", {
    p_tenant: me.tenantId, p_actor: me.id, p_code: input.code,
    p_label: input.labelFr, p_start: input.periodStart, p_end: input.periodEnd,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.payroll.period_created", actorId: me.id, tenantId: me.tenantId,
    entity: "hr_payroll_period", entityId: (data as string) ?? null,
    after: { code: input.code, start: input.periodStart, end: input.periodEnd } });
  revalidatePath(PATH);
  return { ok: true, id: (data as string) ?? undefined };
}

/** Collect the facts (idempotent re-collection while pre-VERIFIED). */
export async function preparePayrollPeriod(periodId: string): Promise<PayrollResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "forbidden" };
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_prepare_payroll_period", {
    p_tenant: me.tenantId, p_period: periodId, p_actor: me.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.payroll.facts_collected", actorId: me.id, tenantId: me.tenantId,
    entity: "hr_payroll_period", entityId: periodId, after: { lines: (data as number) ?? 0 } });
  revalidatePath(PATH);
  return { ok: true, id: periodId, count: (data as number | null) ?? 0 };
}

export async function verifyPayrollPeriod(periodId: string): Promise<PayrollResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "forbidden" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_verify_payroll_period", {
    p_tenant: me.tenantId, p_period: periodId, p_actor: me.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.payroll.period_verified", actorId: me.id, tenantId: me.tenantId,
    entity: "hr_payroll_period", entityId: periodId });
  revalidatePath(PATH);
  return { ok: true, id: periodId };
}

export async function reopenPayrollPeriod(periodId: string): Promise<PayrollResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "forbidden" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_reopen_payroll_period", {
    p_tenant: me.tenantId, p_period: periodId, p_actor: me.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.payroll.period_reopened", actorId: me.id, tenantId: me.tenantId,
    entity: "hr_payroll_period", entityId: periodId });
  revalidatePath(PATH);
  return { ok: true, id: periodId };
}

/** Approval/lock assert the PARKED hr:payroll:approve in the RPC (Q7). */
export async function approvePayrollPeriod(periodId: string): Promise<PayrollResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "forbidden_payroll" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_approve_payroll_period", {
    p_tenant: me.tenantId, p_period: periodId, p_actor: me.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.payroll.period_approved", actorId: me.id, tenantId: me.tenantId,
    entity: "hr_payroll_period", entityId: periodId });
  revalidatePath(PATH);
  return { ok: true, id: periodId };
}

export async function lockPayrollPeriod(periodId: string): Promise<PayrollResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "forbidden_payroll" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_lock_payroll_period", {
    p_tenant: me.tenantId, p_period: periodId, p_actor: me.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.payroll.period_locked", actorId: me.id, tenantId: me.tenantId,
    entity: "hr_payroll_period", entityId: periodId });
  revalidatePath(PATH);
  return { ok: true, id: periodId };
}

export async function cancelPayrollPeriod(periodId: string, reason: string): Promise<PayrollResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "forbidden" };
  if (!reason.trim()) return { ok: false, error: "reason_required" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_cancel_payroll_period", {
    p_tenant: me.tenantId, p_period: periodId, p_actor: me.id, p_reason: reason.trim(),
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.payroll.period_cancelled", actorId: me.id, tenantId: me.tenantId,
    entity: "hr_payroll_period", entityId: periodId, after: { reason: reason.trim() } });
  revalidatePath(PATH);
  return { ok: true, id: periodId };
}

/* ------------------------------------------------------------- adjustments */

export async function proposePayrollAdjustment(input: {
  periodId: string; employeeId: string; kindId: string; quantity: number;
  reason?: string | null; evidenceDocumentId?: string | null;
  supersedesAdjustmentId?: string | null;
}): Promise<PayrollResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "forbidden" };
  if (!Number.isInteger(input.quantity) || input.quantity === 0) {
    return { ok: false, error: "invalid_quantity" };
  }
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_propose_payroll_adjustment", {
    p_tenant: me.tenantId, p_period: input.periodId, p_employee: input.employeeId,
    p_kind: input.kindId, p_actor: me.id, p_quantity: input.quantity,
    p_reason: input.reason || null, p_evidence: input.evidenceDocumentId || null,
    p_supersedes: input.supersedesAdjustmentId || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.payroll.adjustment_proposed", actorId: me.id, tenantId: me.tenantId,
    entity: "hr_payroll_adjustment", entityId: (data as string) ?? null,
    after: { period_id: input.periodId, amendment: Boolean(input.supersedesAdjustmentId) } });
  revalidatePath(PATH);
  return { ok: true, id: (data as string) ?? undefined };
}

export async function decidePayrollAdjustment(input: {
  adjustmentId: string; decision: "APPROVED" | "REJECTED"; note?: string | null;
}): Promise<PayrollResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "forbidden" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_decide_payroll_adjustment", {
    p_tenant: me.tenantId, p_adjustment: input.adjustmentId, p_actor: me.id,
    p_decision: input.decision, p_note: input.note?.trim() || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: `hr.payroll.adjustment_${input.decision.toLowerCase()}`, actorId: me.id,
    tenantId: me.tenantId, entity: "hr_payroll_adjustment", entityId: input.adjustmentId });
  revalidatePath(PATH);
  return { ok: true, id: input.adjustmentId };
}

/* ---------------------------------------------- vocabulary (configuration) */

/** The adjustment vocabulary is the tenant's, entered by them — never seeded. */
export async function upsertAdjustmentKind(input: {
  id?: string; code: string; labelFr: string;
  unit: "HOURS" | "DAYS" | "OCCURRENCES" | "UNITS";
  requiresReason?: boolean; isActive?: boolean;
}): Promise<PayrollResult> {
  let admin;
  try { admin = await assertPermission("hr:config:manage"); } catch { return { ok: false, error: "forbidden_config" }; }
  if (!input.code.trim() || !input.labelFr.trim()) return { ok: false, error: "missing_field" };
  const s = getAdminSupabaseClient();
  const row = {
    tenant_id: admin.tenantId, code: input.code.trim().toUpperCase(), label_fr: input.labelFr.trim(),
    unit: input.unit, requires_reason: input.requiresReason ?? true, is_active: input.isActive ?? true,
  };
  if (input.id) {
    const patch = { code: row.code, label_fr: row.label_fr, unit: row.unit,
      requires_reason: row.requires_reason, is_active: row.is_active };
    const { error } = await s.from("hr_payroll_adjustment_kind").update(patch)
      .eq("id", input.id).eq("tenant_id", admin.tenantId);
    if (error) return { ok: false, error: "save_failed", detail: error.message };
    await writeAudit({ action: "hr.payroll.kind_updated", actorId: admin.id, tenantId: admin.tenantId,
      entity: "hr_payroll_adjustment_kind", entityId: input.id, after: { code: row.code } });
    revalidatePath(PATH);
    return { ok: true, id: input.id };
  }
  const { data, error } = await s.from("hr_payroll_adjustment_kind").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed", detail: error?.message };
  await writeAudit({ action: "hr.payroll.kind_created", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_payroll_adjustment_kind", entityId: data.id, after: { code: row.code } });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

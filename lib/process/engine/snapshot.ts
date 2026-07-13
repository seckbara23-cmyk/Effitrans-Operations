/**
 * Process engine — dossier snapshot (Phase 5.0B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * One bounded batch read that assembles everything the pure core needs for a
 * dossier: the process instance, its step executions, its handoffs, and an
 * EvidenceSnapshot over the EXISTING records (document / customs / transport /
 * invoice / payment).
 *
 * NO N+1. Every table is hit at most once per dossier, in parallel. The engine
 * never re-queries per step — the pure functions take the snapshot and decide.
 *
 * Evidence is REFERENCED, never copied: nothing here writes to document,
 * customs_record, transport_record, invoice or payment.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import type { EvidenceSnapshot } from "./evidence";
import type { ExecutionView } from "./state";
import type { HandoffRow, ProcessInstanceRow, StepExecutionRow } from "./types";

export type ProcessSnapshot = {
  instance: ProcessInstanceRow | null;
  executions: StepExecutionRow[];
  handoffs: HandoffRow[];
  evidence: EvidenceSnapshot;
  file: { id: string; type: string; status: string };
};

type Row = Record<string, unknown>;

const s = (v: unknown): string | null => (typeof v === "string" ? v : null);

function toInstance(r: Row): ProcessInstanceRow {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    fileId: r.file_id as string,
    processVersion: r.process_version as string,
    status: r.status as ProcessInstanceRow["status"],
    compatibilitySource: r.compatibility_source as ProcessInstanceRow["compatibilitySource"],
    compatibilityVersion: s(r.compatibility_version),
    startedAt: r.started_at as string,
    completedAt: s(r.completed_at),
    closedAt: s(r.closed_at),
  };
}

function toExecution(r: Row): StepExecutionRow {
  return {
    id: r.id as string,
    processInstanceId: r.process_instance_id as string,
    stepKey: r.step_key as string,
    stepNumber: (r.step_number as number | null) ?? null,
    state: r.state as StepExecutionRow["state"],
    assignedUserId: s(r.assigned_user_id),
    assignedRoleCode: s(r.assigned_role_code),
    submittedBy: s(r.submitted_by),
    submittedAt: s(r.submitted_at),
    reviewedBy: s(r.reviewed_by),
    reviewedAt: s(r.reviewed_at),
    receivedFromUserId: s(r.received_from_user_id),
    receivedAt: s(r.received_at),
    startedAt: s(r.started_at),
    completedAt: s(r.completed_at),
    rejectedAt: s(r.rejected_at),
    rejectedBy: s(r.rejected_by),
    rejectionReason: s(r.rejection_reason),
    correctionOfId: s(r.correction_of_id),
    overrideUsed: Boolean(r.override_used),
    overrideReason: s(r.override_reason),
    evidenceSummary: r.evidence_summary ?? null,
  };
}

function toHandoff(r: Row): HandoffRow {
  return {
    id: r.id as string,
    processInstanceId: r.process_instance_id as string,
    fromStepKey: r.from_step_key as string,
    toStepKey: r.to_step_key as string,
    sentBy: r.sent_by as string,
    sentAt: r.sent_at as string,
    receivedBy: s(r.received_by),
    receivedAt: s(r.received_at),
    status: r.status as HandoffRow["status"],
    rejectionReason: s(r.rejection_reason),
    returnedToStepKey: s(r.returned_to_step_key),
    dedupKey: r.dedup_key as string,
  };
}

/** Executions in the shape the pure core consumes. */
export function toViews(executions: StepExecutionRow[]): ExecutionView[] {
  return executions.map((e) => ({
    stepKey: e.stepKey,
    state: e.state,
    submittedBy: e.submittedBy,
    reviewedBy: e.reviewedBy,
  }));
}

/**
 * Load everything for one dossier in a single bounded batch.
 *
 * `permissions` gates which EVIDENCE the caller may see — an unreadable module
 * yields `unauthorized` items rather than a silent false negative, so the engine
 * never claims evidence is missing when the caller simply cannot look.
 */
export async function loadProcessSnapshot(
  tenantId: string,
  fileId: string,
  permissions: string[],
): Promise<ProcessSnapshot | null> {
  const admin = getAdminSupabaseClient();

  const { data: fileRows } = await scopedFrom(admin, "operational_file", tenantId)
    .select("id, type, status")
    .eq("id", fileId)
    .limit(1);
  const file = ((fileRows ?? []) as Row[])[0];
  if (!file) return null;

  const access = {
    documents: hasPermission(permissions, "document:read"),
    customs: hasPermission(permissions, "customs:read"),
    transport: hasPermission(permissions, "transport:read"),
    finance: hasPermission(permissions, "finance:read"),
  };

  const { data: instRows } = await scopedFrom(admin, "process_instance", tenantId)
    .select("*")
    .eq("file_id", fileId)
    .neq("status", "CANCELLED")
    .limit(1);
  const instance = ((instRows ?? []) as Row[])[0] ?? null;

  const instanceId = instance?.id as string | undefined;

  // One query per table, all in parallel. Nothing is fetched per-step.
  const [execRes, handoffRes, docRes, customsRes, transportRes, invoiceRes] = await Promise.all([
    instanceId
      ? scopedFrom(admin, "process_step_execution", tenantId)
          .select("*")
          .eq("process_instance_id", instanceId)
      : Promise.resolve({ data: [] as Row[] }),
    instanceId
      ? scopedFrom(admin, "process_handoff", tenantId)
          .select("*")
          .eq("process_instance_id", instanceId)
      : Promise.resolve({ data: [] as Row[] }),
    access.documents
      ? scopedFrom(admin, "document", tenantId)
          .select("type_code, status")
          .eq("file_id", fileId)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as Row[] }),
    access.customs
      ? scopedFrom(admin, "customs_record", tenantId)
          .select("required, status, bae_reference, declaration_number, external_ref")
          .eq("file_id", fileId)
          .is("deleted_at", null)
          .limit(1)
      : Promise.resolve({ data: [] as Row[] }),
    access.transport
      ? scopedFrom(admin, "transport_record", tenantId)
          .select("status, vehicle_plate, driver_name, driver_user_id")
          .eq("file_id", fileId)
          .is("deleted_at", null)
          .limit(1)
      : Promise.resolve({ data: [] as Row[] }),
    access.finance
      ? scopedFrom(admin, "invoice", tenantId).select("id, status").eq("file_id", fileId)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  // Invoice balances: ONE payments query for all of this dossier's invoices.
  const invoices = (invoiceRes.data ?? []) as Row[];
  let balances = new Map<string, number>();
  if (access.finance && invoices.length > 0) {
    const ids = invoices.map((i) => i.id as string);
    const [{ data: lines }, { data: payments }] = await Promise.all([
      scopedFrom(admin, "invoice_line", tenantId).select("invoice_id, quantity, unit_amount, tax_rate").in("invoice_id", ids),
      scopedFrom(admin, "payment", tenantId).select("invoice_id, amount, reversed_at").in("invoice_id", ids),
    ]);
    const total = new Map<string, number>();
    for (const l of (lines ?? []) as Row[]) {
      const q = Number(l.quantity ?? 0);
      const u = Number(l.unit_amount ?? 0);
      const t = Number(l.tax_rate ?? 0);
      const id = l.invoice_id as string;
      total.set(id, (total.get(id) ?? 0) + q * u * (1 + t / 100));
    }
    const paid = new Map<string, number>();
    for (const p of (payments ?? []) as Row[]) {
      if (p.reversed_at) continue;
      const id = p.invoice_id as string;
      paid.set(id, (paid.get(id) ?? 0) + Number(p.amount ?? 0));
    }
    balances = new Map(invoices.map((i) => {
      const id = i.id as string;
      return [id, (total.get(id) ?? 0) - (paid.get(id) ?? 0)];
    }));
  }

  const customs = ((customsRes.data ?? []) as Row[])[0] ?? null;
  const transport = ((transportRes.data ?? []) as Row[])[0] ?? null;

  const evidence: EvidenceSnapshot = {
    fileType: file.type as string,
    access,
    documents: ((docRes.data ?? []) as Row[]).map((d) => ({
      typeCode: d.type_code as string,
      status: d.status as string,
    })),
    customs: customs
      ? {
          required: Boolean(customs.required),
          status: customs.status as string,
          baeReference: s(customs.bae_reference),
          declarationNumber: s(customs.declaration_number),
          externalRef: s(customs.external_ref),
        }
      : null,
    transport: transport
      ? {
          status: transport.status as string,
          vehiclePlate: s(transport.vehicle_plate),
          driverName: s(transport.driver_name),
          driverUserId: s(transport.driver_user_id),
        }
      : null,
    invoices: invoices.map((i) => ({
      status: i.status as string,
      balance: balances.get(i.id as string) ?? 0,
    })),
  };

  return {
    instance: instance ? toInstance(instance) : null,
    executions: ((execRes.data ?? []) as Row[]).map(toExecution),
    handoffs: ((handoffRes.data ?? []) as Row[]).map(toHandoff),
    evidence,
    file: {
      id: file.id as string,
      type: file.type as string,
      status: file.status as string,
    },
  };
}

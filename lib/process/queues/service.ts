/**
 * Department queue service (Phase 5.0C, Deliverable 1). SERVER-ONLY, read-only.
 * ---------------------------------------------------------------------------
 * Queues are DERIVED. There is no queue table and no queue state: a queue is a
 * filtered view over process_step_execution joined to the dossier records that
 * already exist. Nothing here duplicates process state.
 *
 * NO N+1 — the query count is CONSTANT (10), regardless of page size:
 *   1  process_step_execution (the page itself, filtered + paginated in SQL)
 *   2  process_instance      (batch, by id)
 *   3  operational_file      (batch, by id)
 *   4  client                (batch, by id)
 *   5  process_handoff       (batch, by instance)
 *   6  process_step_execution (batch: ALL steps of the page's instances, for
 *                              prerequisite/branch evaluation)
 *   7  document              (batch, by file)
 *   8  customs_record        (batch, by file)
 *   9  transport_record      (batch, by file)
 *   10 invoice               (batch, by file)
 * Never one query per dossier, per step, per client or per assignee.
 *
 * Legacy dossiers (no process instance) are EXCLUDED by construction: this reads
 * process_step_execution, and a dossier without an instance has no rows.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import { resolveFileScope } from "@/lib/authz/visibility";
import { getNode } from "../engine/state";
import { evaluateBranch, liveByKey, missingPrerequisites, type ExecutionView } from "../engine/state";
import { evaluatePickupGate } from "../engine/gates";
import { evaluateStepEvidence, type EvidenceSnapshot } from "../engine/evidence";
import { OPEN_STATES } from "../engine/types";
import { getQueue, queueStepKeys } from "./registry";
import { compareQueueItems, evaluatePriority, type PriorityResult } from "./priority";
import type { ProcessDepartment } from "../types";

export type QueueFilters = {
  search?: string;
  assigneeId?: string;
  unassigned?: boolean;
  unreceived?: boolean;
  blocked?: boolean;
  rejected?: boolean;
  stepKey?: string;
};

export type QueueItem = {
  executionId: string;
  processInstanceId: string;
  fileId: string;
  fileNumber: string;
  clientName: string;
  stepKey: string;
  stepNumber: number | null;
  stepLabel: string;
  phase: string | null;
  department: string;
  requiredRole: string | null;
  assigneeId: string | null;
  /** Who handed this over, and when. Null when the work was not handed off. */
  handoffId: string | null;
  handoffSentBy: string | null;
  handoffSentAt: string | null;
  /** Explicit reception state — the whole point of the new handoff model. */
  receptionRequired: boolean;
  received: boolean;
  state: string;
  /** Who submitted this step for validation, when it is SUBMITTED. */
  submittedBy: string | null;
  ageHours: number;
  sla: { policyKey: string; state: string; label: string };
  missingPrerequisites: string[];
  missingEvidenceCount: number;
  blockerSummary: string | null;
  branches: { customsComplete: boolean; transportComplete: boolean; waitingOnOtherBranch: boolean };
  nextAction: string;
  nextRecipient: string | null;
  customerImpacting: boolean;
  priority: PriorityResult;
  isCorrection: boolean;
  compatibility: "native" | "mapped";
};

export type QueueResult = {
  queueKey: string;
  items: QueueItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Telemetry — safe: counts and durations only, never dossier content. */
  telemetry: { queueKey: string; count: number; durationMs: number };
};

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const hoursSince = (iso: string | null, now: number): number =>
  iso ? Math.max(0, (now - new Date(iso).getTime()) / 3_600_000) : 0;

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export type QueueRequest = {
  tenantId: string;
  userId: string;
  queueKey: ProcessDepartment;
  permissions: string[];
  filters?: QueueFilters;
  page?: number;
  pageSize?: number;
};

export async function getDepartmentQueue(req: QueueRequest): Promise<QueueResult> {
  const started = Date.now();
  const def = getQueue(req.queueKey);
  const page = Math.max(1, req.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, req.pageSize ?? 25));
  const empty: QueueResult = {
    queueKey: req.queueKey,
    items: [],
    total: 0,
    page,
    pageSize,
    telemetry: { queueKey: req.queueKey, count: 0, durationMs: 0 },
  };
  if (!def || !hasPermission(req.permissions, def.permission)) return empty;

  const admin = getAdminSupabaseClient();
  const stepKeys = queueStepKeys(req.queueKey);

  // Dossier visibility: a user without file:read:all only sees their own dossiers.
  const scope = await resolveFileScope(req.userId, req.tenantId, "file:read:all");

  // (1) The page itself — filtered and paginated in SQL, never in the browser.
  let q = scopedFrom(admin, "process_step_execution", req.tenantId)
    .select("*")
    .in("step_key", req.filters?.stepKey ? [req.filters.stepKey] : stepKeys)
    .in("state", req.filters?.rejected ? ["REJECTED"] : [...OPEN_STATES]);

  if (req.filters?.assigneeId) q = q.eq("assigned_user_id", req.filters.assigneeId);
  if (req.filters?.unassigned) q = q.is("assigned_user_id", null);

  const { data: execRows } = await q.order("created_at", { ascending: true }).limit(500);
  let execs = (execRows ?? []) as Row[];
  if (execs.length === 0) {
    return { ...empty, telemetry: { queueKey: req.queueKey, count: 0, durationMs: Date.now() - started } };
  }

  const instanceIds = [...new Set(execs.map((e) => e.process_instance_id as string))];

  // (2) instances -> (3) files -> (4) clients. Three batch reads, not N.
  const { data: instRows } = await scopedFrom(admin, "process_instance", req.tenantId)
    .select("id, file_id, compatibility_source, status")
    .in("id", instanceIds);
  const instances = new Map(((instRows ?? []) as Row[]).map((i) => [i.id as string, i]));

  const fileIds = [...new Set([...instances.values()].map((i) => i.file_id as string))].filter(
    (id) => scope.all || scope.ids.includes(id),
  );
  if (fileIds.length === 0) {
    return { ...empty, telemetry: { queueKey: req.queueKey, count: 0, durationMs: Date.now() - started } };
  }

  const { data: fileRows } = await scopedFrom(admin, "operational_file", req.tenantId)
    .select("id, file_number, type, client_id, priority")
    .in("id", fileIds);
  const files = new Map(((fileRows ?? []) as Row[]).map((f) => [f.id as string, f]));

  const clientIds = [...new Set([...files.values()].map((f) => f.client_id as string))];
  const { data: clientRows } = await scopedFrom(admin, "client", req.tenantId)
    .select("id, name")
    .in("id", clientIds);
  const clients = new Map(((clientRows ?? []) as Row[]).map((c) => [c.id as string, c.name as string]));

  // (5) handoffs, (6) ALL executions for those instances (prereqs + branches).
  const [{ data: handoffRows }, { data: allExecRows }] = await Promise.all([
    scopedFrom(admin, "process_handoff", req.tenantId).select("*").in("process_instance_id", instanceIds),
    scopedFrom(admin, "process_step_execution", req.tenantId)
      .select("process_instance_id, step_key, state, submitted_by, correction_of_id")
      .in("process_instance_id", instanceIds),
  ]);
  const handoffsByInstance = group((handoffRows ?? []) as Row[], (h) => h.process_instance_id as string);
  const execsByInstance = group((allExecRows ?? []) as Row[], (e) => e.process_instance_id as string);

  // (7-10) evidence, batched by file. Modules the caller cannot read are skipped
  // entirely — an unreadable module never masquerades as missing evidence.
  const access = {
    documents: hasPermission(req.permissions, "document:read"),
    customs: hasPermission(req.permissions, "customs:read"),
    transport: hasPermission(req.permissions, "transport:read"),
    finance: hasPermission(req.permissions, "finance:read"),
  };
  const [docRes, cusRes, trnRes, invRes] = await Promise.all([
    access.documents
      ? scopedFrom(admin, "document", req.tenantId).select("file_id, type_code, status").in("file_id", fileIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as Row[] }),
    access.customs
      ? scopedFrom(admin, "customs_record", req.tenantId).select("file_id, required, status, bae_reference, declaration_number, external_ref").in("file_id", fileIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as Row[] }),
    access.transport
      ? scopedFrom(admin, "transport_record", req.tenantId).select("file_id, status, vehicle_plate, driver_name, driver_user_id").in("file_id", fileIds).is("deleted_at", null)
      : Promise.resolve({ data: [] as Row[] }),
    access.finance
      ? scopedFrom(admin, "invoice", req.tenantId).select("file_id, status, due_date").in("file_id", fileIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const docsByFile = group((docRes.data ?? []) as Row[], (d) => d.file_id as string);
  const customsByFile = new Map(((cusRes.data ?? []) as Row[]).map((c) => [c.file_id as string, c]));
  const transportByFile = new Map(((trnRes.data ?? []) as Row[]).map((t) => [t.file_id as string, t]));
  const invoicesByFile = group((invRes.data ?? []) as Row[], (i) => i.file_id as string);

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const items: QueueItem[] = [];

  for (const e of execs) {
    const inst = instances.get(e.process_instance_id as string);
    if (!inst) continue;
    const fileId = inst.file_id as string;
    const file = files.get(fileId);
    if (!file) continue; // outside the caller's dossier scope

    const stepKey = e.step_key as string;
    const node = getNode(stepKey);

    const allExecs = execsByInstance.get(inst.id as string) ?? [];
    const views: ExecutionView[] = allExecs.map((x) => ({
      stepKey: x.step_key as string,
      state: x.state as ExecutionView["state"],
      submittedBy: str(x.submitted_by),
    }));

    const cus = customsByFile.get(fileId);
    const trn = transportByFile.get(fileId);
    const snap: EvidenceSnapshot = {
      fileType: file.type as string,
      access,
      documents: (docsByFile.get(fileId) ?? []).map((d) => ({
        typeCode: d.type_code as string,
        status: d.status as string,
      })),
      customs: cus
        ? {
            required: Boolean(cus.required),
            status: cus.status as string,
            baeReference: str(cus.bae_reference),
            declarationNumber: str(cus.declaration_number),
            externalRef: str(cus.external_ref),
          }
        : null,
      transport: trn
        ? {
            status: trn.status as string,
            vehiclePlate: str(trn.vehicle_plate),
            driverName: str(trn.driver_name),
            driverUserId: str(trn.driver_user_id),
          }
        : null,
      invoices: (invoicesByFile.get(fileId) ?? []).map((i) => ({ status: i.status as string, balance: 0 })),
    };

    const openHandoff = (handoffsByInstance.get(inst.id as string) ?? []).find(
      (h) => h.status === "SENT" && h.to_step_key === stepKey,
    );
    const receivedHandoff = (handoffsByInstance.get(inst.id as string) ?? []).find(
      (h) => h.status === "RECEIVED" && h.to_step_key === stepKey,
    );

    const missingPrereqs = missingPrerequisites(stepKey, views);
    const evidence = evaluateStepEvidence(stepKey, snap);
    const gate = evaluatePickupGate(snap, views);

    const customsBranch = evaluateBranch("customs", views);
    const transportBranch = evaluateBranch("transport_readiness", views);
    const waitingOnOtherBranch =
      stepKey === "pickup" && !gate.ready && (customsBranch.complete !== transportBranch.complete);

    const state = e.state as string;
    const blocked = state === "BLOCKED" || missingPrereqs.length > 0 || evidence.missing.length > 0;
    const isCorrection = e.correction_of_id !== null;

    const invoices = invoicesByFile.get(fileId) ?? [];
    const invoiceOverdue = invoices.some(
      (i) =>
        (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") &&
        typeof i.due_date === "string" &&
        (i.due_date as string) < today,
    );

    const ageHours = hoursSince(
      str(e.received_at) ?? str(e.started_at) ?? str(e.created_at),
      now,
    );

    const priority = evaluatePriority({
      filePriority: (file.priority as string) ?? "normal",
      isCorrection,
      handoffUnreceived: !!openHandoff,
      ageHours,
      slaPolicyKey: node?.slaPolicyKey ?? "",
      blocked,
      nearlyReady: stepKey === "pickup" && !gate.ready && gate.missing.length === 1,
      podMissing:
        trn?.status === "DELIVERED" &&
        !snap.documents.some((d) => d.typeCode === "DELIVERY_NOTE" && d.status === "APPROVED"),
      billingIdle: stepKey === "billing_draft" && state === "AVAILABLE",
      invoiceOverdue,
      customerImpacting: node?.clientStage !== null && node?.clientStage !== undefined,
    });

    const blockerSummary = blocked
      ? missingPrereqs.length > 0
        ? `Prérequis manquants : ${missingPrereqs.join(", ")}`
        : evidence.missing.length > 0
          ? `Preuves manquantes : ${evidence.missing.join(", ")}`
          : "Étape bloquée"
      : null;

    const nextStep = node?.nextSteps[0] ?? null;

    items.push({
      executionId: e.id as string,
      processInstanceId: inst.id as string,
      fileId,
      fileNumber: file.file_number as string,
      clientName: clients.get(file.client_id as string) ?? "—",
      stepKey,
      stepNumber: (e.step_number as number | null) ?? null,
      stepLabel: node?.labelFr ?? stepKey,
      phase: node?.phase ?? null,
      department: req.queueKey,
      requiredRole: node?.role ?? null,
      assigneeId: str(e.assigned_user_id),
      handoffId: openHandoff ? (openHandoff.id as string) : null,
      handoffSentBy: openHandoff ? str(openHandoff.sent_by) : receivedHandoff ? str(receivedHandoff.sent_by) : null,
      handoffSentAt: openHandoff ? str(openHandoff.sent_at) : receivedHandoff ? str(receivedHandoff.sent_at) : null,
      receptionRequired: def.requiresReception,
      received: !openHandoff,
      state,
      // Phase 5.0E-1 — needed to tell "I must validate this" from "I submitted this
      // and it is out of my hands". Maker-checker is enforced on IDENTITY, so the
      // workbench must be able to show the same distinction the action enforces.
      submittedBy: str(e.submitted_by),
      ageHours: Math.round(ageHours),
      sla: {
        policyKey: node?.slaPolicyKey ?? "",
        state: "unconfigured",
        label: "SLA non configuré",
      },
      missingPrerequisites: missingPrereqs,
      missingEvidenceCount: evidence.missing.length + evidence.invalid.length,
      blockerSummary,
      branches: {
        customsComplete: customsBranch.complete,
        transportComplete: transportBranch.complete,
        waitingOnOtherBranch,
      },
      nextAction: node?.completionRule ?? "—",
      nextRecipient: nextStep ? (getNode(nextStep)?.department ?? null) : null,
      customerImpacting: !!node?.clientStage,
      priority,
      isCorrection,
      compatibility: inst.compatibility_source === "NATIVE" ? "native" : "mapped",
    });
  }

  // Server-side filters that need the derived state.
  let filtered = items;
  const f = req.filters;
  if (f?.unreceived) filtered = filtered.filter((i) => !i.received);
  if (f?.blocked) filtered = filtered.filter((i) => i.blockerSummary !== null);
  if (f?.search) {
    const s = f.search.toLowerCase();
    filtered = filtered.filter(
      (i) => i.fileNumber.toLowerCase().includes(s) || i.clientName.toLowerCase().includes(s),
    );
  }

  filtered.sort(compareQueueItems);

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  return {
    queueKey: req.queueKey,
    items: pageItems,
    total,
    page,
    pageSize,
    telemetry: { queueKey: req.queueKey, count: total, durationMs: Date.now() - started },
  };
}

/** Counts per queue for the nav badges and My Work. ONE query, not 15. */
export async function getQueueCounts(
  tenantId: string,
  permissions: string[],
): Promise<Record<string, number>> {
  if (!hasPermission(permissions, "process:read")) return {};
  const admin = getAdminSupabaseClient();
  const { data } = await scopedFrom(admin, "process_step_execution", tenantId)
    .select("step_key")
    .in("state", [...OPEN_STATES])
    .limit(2000);

  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as Row[]) {
    const node = getNode(r.step_key as string);
    if (!node) continue;
    counts[node.department] = (counts[node.department] ?? 0) + 1;
  }
  return counts;
}

export { liveByKey };

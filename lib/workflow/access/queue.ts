/**
 * Department work queue (Phase WES-3H). SERVER-ONLY, READ-ONLY.
 * ---------------------------------------------------------------------------
 * Answers the question WES-3 left open: **how does a department member DISCOVER
 * the work their department owns?** Without this, `Mon Travail` was the only
 * place work existed, so anything unassigned was invisible to everyone.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * It is NOT `lib/process/queues/service.ts`. That queue is step-execution
 * centric and keyed on `ProcessDepartment` — one of the 15 workflow QUEUE
 * codes. This one is dossier-centric and keyed on the user's CANONICAL
 * department, derived from their roles, with responsibility taken from the
 * WES-2 projection. Different axis, different question; neither replaces the
 * other and no vocabulary is invented for either.
 *
 * ---------------------------------------------------------------------------
 * SOURCE OF TRUTH (WES-3A.3)
 *
 * Department ownership comes from **the canonical projection's
 * `responsibleDepartment`**, bridged to the organization's departments. It is
 * NEVER inferred from `operational_file.assigned_to_user_id` (retired), from
 * the mere presence of a task, from document uploads, or from free-text role
 * labels. Tasks are work items, not workflow authority.
 *
 * Visibility never widens: a row appears only if the WES-3 access resolver
 * grants at least summary access, and detail fields are omitted when it does
 * not grant current detail.
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { buildCanonicalProjection } from "@/lib/workflow/projection";
import { canonicalDepartmentsForRoles, canonicalDepartmentForLifecycle } from "./departments";
import { resolveDossierAccess } from "./resolver";
import type { CanonicalStageKey } from "@/lib/workflow/stages";
import type { Department } from "@/lib/files/lifecycle";
import { QUEUE_CATEGORIES, type QueueCategory } from "./vocabulary";

export { QUEUE_CATEGORIES, QUEUE_CATEGORY_LABELS_FR, type QueueCategory } from "./vocabulary";

export type DepartmentQueueRow = {
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  /** From the WES-2 projection. Not recomputed. */
  stage: CanonicalStageKey;
  stageLabelFr: string;
  responsibleDepartment: Department;
  /** The current work item, when there is one. */
  workTitle: string | null;
  workKind: "task" | "step" | null;
  assigneeId: string | null;
  assigneeLabel: string | null;
  blocked: boolean;
  awaitingReception: boolean;
  priority: string;
  lastActivityAt: string;
  categories: QueueCategory[];
  /** True when this user may open operational detail (WES-3C). */
  canOpenDetail: boolean;
};

export type DepartmentQueue = {
  /** Empty when the user belongs to no dossier-processing department. */
  departments: string[];
  rows: DepartmentQueueRow[];
  counts: Record<QueueCategory, number>;
};

const EMPTY: DepartmentQueue = {
  departments: [],
  rows: [],
  counts: {
    unassigned: 0, mine: 0, colleague: 0,
    blocked: 0, awaiting_reception: 0, recently_completed: 0,
  },
};

/** Bounded: a queue is for working, not for exporting the whole tenant. */
const MAX_DOSSIERS = 300;
/** "Recently" is a fixed window so the category is deterministic, not drifting. */
const RECENTLY_COMPLETED_DAYS = 7;

const STAGE_LABELS_FR: Record<CanonicalStageKey, string> = {
  draft: "Brouillon",
  open: "Ouvert",
  documentation: "Documentation",
  customs: "Douane",
  transport: "Transport",
  finance: "Finance",
  archive: "Archivage",
};

export const getDepartmentWorkQueue = cache(async (): Promise<DepartmentQueue> => {
  const user = await getCurrentUser();
  if (!user) return EMPTY;

  const myDepartments = canonicalDepartmentsForRoles(user.roles);
  if (myDepartments.length === 0) return EMPTY;

  const supabase = getAdminSupabaseClient();
  const permissions = await getEffectivePermissions(user.id);

  // Active dossiers only. A closed dossier is not work.
  const { data: files } = await supabase
    .from("operational_file")
    .select("id, file_number, type, status, priority, updated_at, account_manager_id, coordinator_id, client:client_id(name)")
    .eq("tenant_id", user.tenantId)
    .neq("status", "CLOSED")
    .order("updated_at", { ascending: false })
    .limit(MAX_DOSSIERS);

  const fileRows = (files ?? []) as unknown as {
    id: string; file_number: string | null; type: string; status: string;
    priority: string; updated_at: string;
    account_manager_id: string | null; coordinator_id: string | null;
    client: { name: string } | { name: string }[] | null;
  }[];
  if (fileRows.length === 0) return { ...EMPTY, departments: myDepartments };

  const ids = fileRows.map((f) => f.id);

  // Bulk inputs for the projections — the same technique the control tower
  // uses, so one queue render is a handful of queries rather than N×5.
  const [docs, docTypes, customs, transport, invoices, tasks, handoffs, instances] =
    await Promise.all([
      supabase.from("document").select("file_id, type_code, status")
        .eq("tenant_id", user.tenantId).in("file_id", ids).is("deleted_at", null),
      supabase.from("document_type").select("code, required_for").eq("active", true),
      supabase.from("customs_record").select("file_id, status, required")
        .eq("tenant_id", user.tenantId).in("file_id", ids),
      supabase.from("transport_record").select("file_id, status")
        .eq("tenant_id", user.tenantId).in("file_id", ids),
      supabase.from("invoice").select("file_id, status")
        .eq("tenant_id", user.tenantId).in("file_id", ids),
      supabase.from("task").select("id, file_id, title, status, assigned_to, updated_at, completed_at")
        .eq("tenant_id", user.tenantId).in("file_id", ids),
      supabase.from("process_handoff").select("process_instance_id, to_step_key, received_at")
        .eq("tenant_id", user.tenantId).is("received_at", null),
      supabase.from("process_instance").select("id, file_id, owner_user_id")
        .eq("tenant_id", user.tenantId).in("file_id", ids),
    ]);

  const docsBy = new Map<string, { type_code: string; status: string }[]>();
  for (const d of docs.data ?? []) {
    const arr = docsBy.get(d.file_id as string) ?? [];
    arr.push({ type_code: d.type_code as string, status: d.status as string });
    docsBy.set(d.file_id as string, arr);
  }
  const requiredFor = (type: string) =>
    (docTypes.data ?? [])
      .filter((t) => ((t.required_for as string[] | null) ?? []).includes(type))
      .map((t) => t.code as string);

  const customsBy = new Map((customs.data ?? []).map((c) => [c.file_id as string, c]));
  const transportBy = new Map((transport.data ?? []).map((t) => [t.file_id as string, t]));
  const invoicesBy = new Map<string, { status: string; balance: number }[]>();
  for (const i of invoices.data ?? []) {
    const arr = invoicesBy.get(i.file_id as string) ?? [];
    arr.push({ status: i.status as string, balance: 0 });
    invoicesBy.set(i.file_id as string, arr);
  }

  const instanceBy = new Map(
    (instances.data ?? []).map((p) => [p.file_id as string, p as { id: string; owner_user_id: string | null }]),
  );
  const unreceivedInstances = new Set(
    (handoffs.data ?? []).map((h) => h.process_instance_id as string),
  );

  type TaskRow = {
    id: string; file_id: string; title: string; status: string;
    assigned_to: string | null; updated_at: string; completed_at: string | null;
  };
  const tasksBy = new Map<string, TaskRow[]>();
  for (const t of (tasks.data ?? []) as unknown as TaskRow[]) {
    const arr = tasksBy.get(t.file_id) ?? [];
    arr.push(t);
    tasksBy.set(t.file_id, arr);
  }

  // Assignee display names, tenant-scoped.
  const assigneeIds = Array.from(
    new Set(((tasks.data ?? []) as unknown as TaskRow[]).map((t) => t.assigned_to).filter(Boolean)),
  ) as string[];
  const names = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data } = await supabase
      .from("app_user").select("id, name, email")
      .eq("tenant_id", user.tenantId).in("id", assigneeIds);
    for (const u of data ?? []) {
      names.set(u.id as string, (u.name as string | null) ?? (u.email as string));
    }
  }

  const recentCutoff = Date.now() - RECENTLY_COMPLETED_DAYS * 86_400_000;
  const rows: DepartmentQueueRow[] = [];

  for (const f of fileRows) {
    const fileDocs = docsBy.get(f.id) ?? [];
    const approved = new Set(fileDocs.filter((d) => d.status === "APPROVED").map((d) => d.type_code));
    const cust = customsBy.get(f.id);
    const tr = transportBy.get(f.id);

    const projection = buildCanonicalProjection({
      fileId: f.id,
      file: { status: f.status, type: f.type },
      documents: fileDocs.map((d) => ({ status: d.status })),
      missingRequired: requiredFor(f.type).filter((c) => !approved.has(c)).map((label) => ({ label })),
      customs: cust ? { status: cust.status as string, required: cust.required as boolean } : null,
      transport: tr ? { status: tr.status as string } : null,
      invoices: invoicesBy.get(f.id) ?? [],
      podApproved: (tr?.status as string | undefined) === "POD_RECEIVED",
    });

    const responsible = projection.responsibleDepartment;
    if (!responsible) continue;

    // THE DEPARTMENT FILTER — projection, not any assignment column.
    if (!myDepartments.includes(canonicalDepartmentForLifecycle(responsible))) continue;

    const fileTasks = tasksBy.get(f.id) ?? [];
    const active = fileTasks.find((t) => t.status === "TODO" || t.status === "IN_PROGRESS") ?? null;
    const instance = instanceBy.get(f.id);

    // WES-3 access. A row that fails summary access is not shown at all.
    const access = resolveDossierAccess({
      userId: user.id,
      roleCodes: user.roles,
      permissions,
      commercialOwnerId: f.account_manager_id ?? f.coordinator_id,
      operationalOwnerId: instance?.owner_user_id ?? null,
      responsibleDepartment: responsible,
      currentStage: projection.currentStage,
      currentTaskAssigneeId: active?.assigned_to ?? null,
      currentStepAssigneeId: null,
      supervisorRoles: [],
      contributedFromDepartments: [],
    });
    if (!access.canViewSummary) continue;

    const awaitingReception = instance ? unreceivedInstances.has(instance.id) : false;
    const blocked = projection.blocked || fileTasks.some((t) => t.status === "BLOCKED");

    const recentlyCompleted = fileTasks.some(
      (t) => t.status === "DONE" && t.completed_at && new Date(t.completed_at).getTime() >= recentCutoff,
    );

    const categories: QueueCategory[] = [];
    if (active && !active.assigned_to) categories.push("unassigned");
    if (active?.assigned_to === user.id) categories.push("mine");
    if (active?.assigned_to && active.assigned_to !== user.id) categories.push("colleague");
    if (blocked) categories.push("blocked");
    if (awaitingReception) categories.push("awaiting_reception");
    if (recentlyCompleted) categories.push("recently_completed");
    // A dossier with no active task and nothing else to say is still departmental
    // work waiting for someone to pick it up.
    if (categories.length === 0 && !active) categories.push("unassigned");
    if (categories.length === 0) continue;

    const client = Array.isArray(f.client) ? f.client[0] : f.client;

    rows.push({
      fileId: f.id,
      fileNumber: f.file_number,
      clientName: client?.name ?? null,
      stage: projection.currentStage,
      stageLabelFr: STAGE_LABELS_FR[projection.currentStage],
      responsibleDepartment: responsible,
      // Detail fields are withheld when the matrix withholds detail.
      workTitle: access.canViewCurrentDepartmentDetail ? (active?.title ?? null) : null,
      workKind: active ? "task" : null,
      assigneeId: access.canViewCurrentDepartmentDetail ? (active?.assigned_to ?? null) : null,
      assigneeLabel: access.canViewCurrentDepartmentDetail && active?.assigned_to
        ? (names.get(active.assigned_to) ?? null)
        : null,
      blocked,
      awaitingReception,
      priority: f.priority,
      lastActivityAt: active?.updated_at ?? f.updated_at,
      categories,
      canOpenDetail: access.canViewCurrentDepartmentDetail,
    });
  }

  // Deterministic order: most recent activity first, then dossier number, so a
  // reload never reshuffles rows that share a timestamp.
  rows.sort(
    (a, b) =>
      b.lastActivityAt.localeCompare(a.lastActivityAt) ||
      (a.fileNumber ?? "").localeCompare(b.fileNumber ?? ""),
  );

  const counts = { ...EMPTY.counts };
  for (const r of rows) for (const c of r.categories) counts[c] += 1;

  return { departments: myDepartments, rows, counts };
});

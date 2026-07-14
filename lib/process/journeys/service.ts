/**
 * "Parcours des dossiers" (Phase 5.0E-3, Deliverable 4). SERVER-ONLY, READ-ONLY.
 * ---------------------------------------------------------------------------
 * Where is every dossier in the official process, and who holds it?
 *
 * This is NOT a role queue. A queue answers "what is waiting on ME"; this answers
 * "what is happening, across everything". It is the only surface that shows a dossier
 * the current user does not personally work on — which is why it is gated on
 * `process:read` and scoped by the same file-visibility rule as every other read.
 *
 * IT NEVER INITIALIZES ANYTHING. A legacy dossier with no process instance appears
 * here, honestly labelled "Non initialisé", and rendering this page does not create
 * one. Auto-initializing on read would silently perform the historical backfill that
 * management has not yet approved — a page that migrates your data by being looked at.
 *
 * QUERY COUNT IS CONSTANT (9), regardless of page size or row count:
 *   1 operational_file   (filtered + capped in SQL)
 *   2 client             (batch)
 *   3 process_instance   (batch, by file)
 *   4 process_step_execution (batch, by instance)
 *   5 process_handoff    (batch, by instance)
 *   6 app_user           (batch, for owner names)
 *   7 customs_record     (batch, by file)
 *   8 transport_record   (batch, by file)
 *   9 invoice            (batch, by file)
 * Never one query per dossier.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import { resolveFileScope } from "@/lib/authz/visibility";
import { getNode, evaluateBranch, missingPrerequisites, type ExecutionView } from "../engine/state";
import { OPEN_STATES } from "../engine/types";
import { stepLabel } from "../labels";
import { mapRole } from "../roles";
import { roleLabel } from "@/lib/navigation/roles";
import { milestoneStates, type MilestoneState } from "./milestones";
import type { ProcessPhase } from "../types";

/** How many candidate dossiers we derive over before paginating. Disclosed, not hidden. */
const WORKING_SET_CAP = 500;

export type JourneyFilter =
  | "all"
  | "blocked"
  | "awaiting_reception"
  | "customs_branch"
  | "transport_branch"
  | "pickup_ready"
  | "delivered"
  | "billing"
  | "collections"
  | "closed"
  | "uninitialized";

export type JourneyRow = {
  fileId: string;
  fileNumber: string;
  clientName: string;
  /** False for a legacy dossier. It is NOT initialized by being looked at. */
  initialized: boolean;
  phase: ProcessPhase | null;
  phaseLabel: string | null;
  currentStepNumber: number | null;
  currentStepLabel: string | null;
  department: string | null;
  /** French. Never a raw role code. */
  responsibleRoleLabel: string | null;
  /** The named person holding it, when there is one. */
  ownerName: string | null;
  branches: { customsComplete: boolean; transportComplete: boolean; activeBranch: "customs" | "transport" | "both" | null };
  blocker: string | null;
  awaitingReception: boolean;
  nextAction: string;
  postDelivery: { delivered: boolean; invoiced: boolean; inCollections: boolean; closed: boolean };
  milestones: { key: string; labelFr: string; state: MilestoneState; branch: "customs" | "transport" | null }[];
  ageDays: number;
  priority: string;
};

export type JourneyPage = {
  rows: JourneyRow[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * True when more dossiers matched than we derived over. Surfaced in the UI rather
   * than silently truncated: a list that quietly drops rows reads as "that's all of
   * them", which is the most damaging thing an operations view can imply.
   */
  capped: boolean;
  telemetry: { count: number; durationMs: number; queries: number };
};

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export type JourneyRequest = {
  tenantId: string;
  userId: string;
  permissions: string[];
  search?: string;
  phase?: string;
  department?: string;
  filter?: JourneyFilter;
  page?: number;
  pageSize?: number;
};

const EMPTY = (page: number, pageSize: number): JourneyPage => ({
  rows: [],
  total: 0,
  page,
  pageSize,
  capped: false,
  telemetry: { count: 0, durationMs: 0, queries: 0 },
});

export async function getJourneys(req: JourneyRequest): Promise<JourneyPage> {
  const started = Date.now();
  const page = Math.max(1, req.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, req.pageSize ?? 25));

  if (!hasPermission(req.permissions, "process:read")) return EMPTY(page, pageSize);

  const admin = getAdminSupabaseClient();
  let queries = 0;

  // The same visibility rule as everywhere else: a user without file:read:all sees
  // only their own dossiers, even here.
  const scope = await resolveFileScope(req.userId, req.tenantId, "file:read:all");

  // (1) The candidate dossiers.
  //
  // Search and the derived filters both run over the working set rather than in SQL.
  // `scopedFrom` deliberately exposes a NARROW query surface (eq/in/is/order/limit) —
  // that narrowness is what lets tests/tenant-scope.test.ts statically prove no
  // service-role read escapes its tenant. Reaching around it for an `ilike` would
  // trade a real safety guarantee for a convenience, on a set we already cap at 500.
  let q = scopedFrom(admin, "operational_file", req.tenantId)
    .select("id, file_number, client_id, status, priority, created_at, type")
    .is("deleted_at", null);

  if (!scope.all) {
    if (scope.ids.length === 0) return EMPTY(page, pageSize);
    q = q.in("id", scope.ids);
  }

  const { data: fileRows } = await q.order("created_at", { ascending: false }).limit(WORKING_SET_CAP + 1);
  queries++;

  const allFiles = (fileRows ?? []) as Row[];
  const capped = allFiles.length > WORKING_SET_CAP;
  const files = capped ? allFiles.slice(0, WORKING_SET_CAP) : allFiles;
  if (files.length === 0) {
    return { ...EMPTY(page, pageSize), telemetry: { count: 0, durationMs: Date.now() - started, queries } };
  }

  const fileIds = files.map((f) => f.id as string);
  const clientIds = [...new Set(files.map((f) => f.client_id as string).filter(Boolean))];

  // (2-5, 7-9) Everything else, batched.
  const [
    { data: clientRows },
    { data: instRows },
    { data: customsRows },
    { data: transportRows },
    { data: invoiceRows },
  ] = await Promise.all([
    clientIds.length
      ? scopedFrom(admin, "client", req.tenantId).select("id, name").in("id", clientIds)
      : Promise.resolve({ data: [] as Row[] }),
    scopedFrom(admin, "process_instance", req.tenantId)
      .select("id, file_id, status")
      .in("file_id", fileIds),
    hasPermission(req.permissions, "customs:read")
      ? scopedFrom(admin, "customs_record", req.tenantId)
          .select("file_id, required, status")
          .in("file_id", fileIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as Row[] }),
    hasPermission(req.permissions, "transport:read")
      ? scopedFrom(admin, "transport_record", req.tenantId)
          .select("file_id, status")
          .in("file_id", fileIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as Row[] }),
    hasPermission(req.permissions, "finance:read")
      ? scopedFrom(admin, "invoice", req.tenantId).select("file_id, status").in("file_id", fileIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  queries += 5;

  const clients = new Map(((clientRows ?? []) as Row[]).map((c) => [c.id as string, c.name as string]));
  const instances = (instRows ?? []) as Row[];
  const instanceByFile = new Map(instances.map((i) => [i.file_id as string, i]));
  const instanceIds = instances.map((i) => i.id as string);

  // (4) and (5): step executions and open handoffs, for the instances that exist.
  const [{ data: execRows }, { data: handoffRows }] = instanceIds.length
    ? await Promise.all([
        scopedFrom(admin, "process_step_execution", req.tenantId)
          .select("process_instance_id, step_key, state, assigned_user_id")
          .in("process_instance_id", instanceIds),
        scopedFrom(admin, "process_handoff", req.tenantId)
          .select("process_instance_id, status, to_step")
          .in("process_instance_id", instanceIds)
          .eq("status", "SENT"),
      ])
    : [{ data: [] as Row[] }, { data: [] as Row[] }];
  queries += instanceIds.length ? 2 : 0;

  const execsByInstance = new Map<string, Row[]>();
  for (const e of (execRows ?? []) as Row[]) {
    const k = e.process_instance_id as string;
    execsByInstance.set(k, [...(execsByInstance.get(k) ?? []), e]);
  }
  const openHandoffByInstance = new Map(
    ((handoffRows ?? []) as Row[]).map((h) => [h.process_instance_id as string, h]),
  );

  // (6) Owner names. Batched, and only for the users actually holding something.
  const ownerIds = [
    ...new Set(
      ((execRows ?? []) as Row[]).map((e) => str(e.assigned_user_id)).filter((v): v is string => Boolean(v)),
    ),
  ];
  const { data: userRows } = ownerIds.length
    ? await scopedFrom(admin, "app_user", req.tenantId).select("id, email").in("id", ownerIds)
    : { data: [] as Row[] };
  queries += ownerIds.length ? 1 : 0;
  const userNames = new Map(((userRows ?? []) as Row[]).map((u) => [u.id as string, u.email as string]));

  const customsByFile = new Map(((customsRows ?? []) as Row[]).map((c) => [c.file_id as string, c]));
  const transportByFile = new Map(((transportRows ?? []) as Row[]).map((t) => [t.file_id as string, t]));
  const invoicesByFile = new Map<string, Row[]>();
  for (const i of (invoiceRows ?? []) as Row[]) {
    const k = i.file_id as string;
    invoicesByFile.set(k, [...(invoicesByFile.get(k) ?? []), i]);
  }

  const now = Date.now();

  // --- derive ---------------------------------------------------------------
  const derived: JourneyRow[] = files.map((f) => {
    const fileId = f.id as string;
    const inst = instanceByFile.get(fileId);
    const initialized = Boolean(inst);
    const execs = inst ? (execsByInstance.get(inst.id as string) ?? []) : [];

    const views: ExecutionView[] = execs.map((e) => ({
      stepKey: e.step_key as string,
      state: e.state as ExecutionView["state"],
      submittedBy: null,
    }));

    // The live step: lowest official number among the open ones.
    const live = execs
      .filter((e) => (OPEN_STATES as readonly string[]).includes(e.state as string))
      .map((e) => ({ e, node: getNode(e.step_key as string) }))
      .filter((x) => x.node)
      .sort((a, b) => (a.node!.stepNumber ?? 99) - (b.node!.stepNumber ?? 99))[0];

    const node = live?.node ?? null;

    const missing = node ? missingPrerequisites(node.key, views) : [];
    const blocked = missing.length > 0 || live?.e.state === "BLOCKED";

    const customsBranch = evaluateBranch("customs", views);
    const transportBranch = evaluateBranch("transport_readiness", views);

    const blockedStepKeys = blocked && node ? [node.key] : [];
    const milestones = milestoneStates(
      execs.map((e) => ({ stepKey: e.step_key as string, state: e.state as string })),
      blockedStepKeys,
    );

    const openHandoff = inst ? openHandoffByInstance.get(inst.id as string) : undefined;

    const status = (f.status as string) ?? "";
    const invoices = invoicesByFile.get(fileId) ?? [];
    const closed = inst?.status === "CLOSED";

    const postDelivery = {
      delivered: status === "DELIVERED" || transportByFile.get(fileId)?.status === "DELIVERED",
      invoiced: invoices.length > 0,
      inCollections: invoices.some((i) =>
        ["ISSUED", "PARTIALLY_PAID"].includes((i.status as string) ?? ""),
      ),
      closed,
    };

    const ownerId = str(live?.e.assigned_user_id);

    const activeBranch: JourneyRow["branches"]["activeBranch"] = !initialized
      ? null
      : customsBranch.complete && transportBranch.complete
        ? null
        : !customsBranch.complete && !transportBranch.complete
          ? "both"
          : !customsBranch.complete
            ? "customs"
            : "transport";

    return {
      fileId,
      fileNumber: (f.file_number as string) ?? "—",
      clientName: clients.get((f.client_id as string) ?? "") ?? "—",
      initialized,
      phase: (node?.phase as ProcessPhase) ?? null,
      phaseLabel: node?.phase ? PHASE_LABEL[node.phase as ProcessPhase] ?? null : null,
      currentStepNumber: node?.stepNumber ?? null,
      currentStepLabel: node ? stepLabel(node.key) : null,
      department: node?.department ?? null,
      responsibleRoleLabel: node?.role ? roleLabelForOfficial(node.role) : null,
      ownerName: ownerId ? (userNames.get(ownerId) ?? null) : null,
      branches: {
        customsComplete: customsBranch.complete,
        transportComplete: transportBranch.complete,
        activeBranch,
      },
      blocker: blocked && missing.length > 0
        ? `Prérequis manquants : ${missing.map(stepLabel).join(", ")}`
        : blocked
          ? "Étape bloquée"
          : null,
      awaitingReception: Boolean(openHandoff),
      nextAction: !initialized
        ? "Dossier non initialisé dans le processus officiel"
        : closed
          ? "Dossier clôturé"
          : openHandoff
            ? "En attente de réception"
            : node
              ? stepLabel(node.key)
              : "Aucune étape active",
      postDelivery,
      milestones,
      ageDays: Math.floor((now - new Date(f.created_at as string).getTime()) / 86_400_000),
      priority: (f.priority as string) ?? "normal",
    };
  });

  // --- derived filters (cannot be expressed in SQL) --------------------------
  const filter = req.filter ?? "all";
  let filtered = derived.filter((r) => {
    switch (filter) {
      case "blocked":
        return r.blocker !== null;
      case "awaiting_reception":
        return r.awaitingReception;
      case "customs_branch":
        return r.initialized && !r.branches.customsComplete;
      case "transport_branch":
        return r.initialized && !r.branches.transportComplete;
      case "pickup_ready":
        return r.branches.customsComplete && r.branches.transportComplete && !r.postDelivery.delivered;
      case "delivered":
        return r.postDelivery.delivered;
      case "billing":
        return r.postDelivery.invoiced && !r.postDelivery.closed;
      case "collections":
        return r.postDelivery.inCollections;
      case "closed":
        return r.postDelivery.closed;
      case "uninitialized":
        return !r.initialized;
      default:
        return true;
    }
  });

  if (req.phase) filtered = filtered.filter((r) => r.phase === req.phase);
  if (req.department) filtered = filtered.filter((r) => r.department === req.department);
  if (req.search?.trim()) {
    const s = req.search.trim().toLowerCase();
    filtered = filtered.filter(
      (r) => r.fileNumber.toLowerCase().includes(s) || r.clientName.toLowerCase().includes(s),
    );
  }

  const total = filtered.length;
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    rows,
    total,
    page,
    pageSize,
    capped,
    telemetry: { count: rows.length, durationMs: Date.now() - started, queries },
  };
}

/** The official phases, in French. Keys are the canonical ProcessPhase values. */
const PHASE_LABEL: Record<ProcessPhase, string> = {
  cotation: "Cotation",
  intake: "Ouverture",
  preparation: "Préparation",
  customs: "Douane",
  transport_readiness: "Préparation transport",
  delivery: "Livraison",
  completeness: "Complétude",
  billing: "Facturation",
  deposit: "Dépôt physique",
  collections: "Recouvrement",
};

/**
 * Official process role → French label, through the tenant role it maps to.
 * Uses the registry's own mapping; there is no second role table.
 */
function roleLabelForOfficial(official: string): string | null {
  try {
    const m = mapRole(official as Parameters<typeof mapRole>[0]);
    return m.tenantRole ? roleLabel(m.tenantRole) : null;
  } catch {
    return null;
  }
}

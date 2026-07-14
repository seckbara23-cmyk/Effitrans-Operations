/**
 * Collections read model (Phase 5.0D-4, Deliverable 9). SERVER-ONLY, read-only.
 * ---------------------------------------------------------------------------
 * NO N+1: a fixed query count regardless of how many receivables are returned.
 * NO SECOND LEDGER: the balance is the same derivation finance uses.
 * Server-side pagination and filters — the browser never receives the whole book.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { hasPermission } from "@/lib/rbac/permissions";
import { balanceDue, invoiceTotals, paidAmount } from "@/lib/finance/calc";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { compareAging, evaluateAging, todayInTimezone, type Aging, type AgingBucket } from "./aging";
import {
  derivePromise,
  evaluateCollectionsPriority,
  type CollectionsPriority,
  type DisputeView,
  type FollowUp,
  type PromiseView,
} from "./model";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => Number(v ?? 0);

export type CollectionsFilters = {
  bucket?: AgingBucket;
  assigneeId?: string;
  unassigned?: boolean;
  disputed?: boolean;
  promiseDue?: boolean;
  missedPromise?: boolean;
  noRecentFollowUp?: boolean;
  partiallyPaid?: boolean;
  fullyPaid?: boolean;
  /** A payment exists but Finance has not verified it — chase Finance. */
  pendingVerification?: boolean;
  search?: string;
  minBalance?: number;
  maxBalance?: number;
  closureReady?: boolean;
};

export type CollectionsRow = {
  invoiceId: string;
  fileId: string;
  fileNumber: string;
  invoiceNumber: string | null;
  clientName: string;
  issueDate: string | null;
  dueDate: string | null;
  total: number;
  paid: number;
  outstanding: number;
  aging: Aging;
  assigneeId: string | null;
  assigneeName: string | null;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  promise: PromiseView;
  dispute: DisputeView;
  /** A payment exists but Finance has not verified it — chase Finance, not the client. */
  paymentAwaitingVerification: boolean;
  priority: CollectionsPriority;
  collectionsCompleted: boolean;
  /** Why this dossier cannot be closed yet. Empty when closure-ready. */
  closureBlockers: string[];
};

export type CollectionsResultPage = {
  rows: CollectionsRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function getCollectionsQueue(
  tenantId: string,
  userId: string,
  permissions: string[],
  filters: CollectionsFilters = {},
  page = 1,
  pageSize = 25,
): Promise<CollectionsResultPage> {
  const empty = { rows: [], total: 0, page, pageSize };
  // TENANT-scoped (5.0E-2A): the service is handed a tenantId, so it asks about THAT
  // tenant, not about the deployment.
  const flags = await getTenantProcessFlags(tenantId);
  if (!flags.collections) return empty;
  if (!hasPermission(permissions, "collections:manage")) return empty;

  const admin = getAdminSupabaseClient();

  // Aging must use the TENANT'S day, not the server's UTC day.
  const { data: org } = await admin.from("organization").select("timezone").eq("id", tenantId).maybeSingle();
  const today = todayInTimezone((org as Row | null)?.timezone as string | undefined ?? "Africa/Dakar");

  // (1) the receivables. A dossier is in Collections once its invoice was sent.
  let q = scopedFrom(admin, "invoice", tenantId)
    .select("*")
    .in("status", ["ISSUED", "PARTIALLY_PAID", "PAID"]);
  if (filters.assigneeId) q = q.eq("collections_assignee_id", filters.assigneeId);
  if (filters.unassigned) q = q.is("collections_assignee_id", null);

  const { data: invRows } = await q.limit(500);
  const invoices = (invRows ?? []) as Row[];
  if (invoices.length === 0) return empty;

  const invoiceIds = invoices.map((i) => i.id as string);
  const fileIds = [...new Set(invoices.map((i) => i.file_id as string))];
  const assigneeIds = [...new Set(invoices.map((i) => i.collections_assignee_id).filter(Boolean))] as string[];

  // (2-7) everything else, batched. Never one query per receivable.
  const [{ data: lines }, { data: payments }, { data: followUps }, { data: files }, { data: users }] =
    await Promise.all([
      scopedFrom(admin, "invoice_line", tenantId)
        .select("invoice_id, quantity, unit_amount, tax_rate")
        .in("invoice_id", invoiceIds),
      scopedFrom(admin, "payment", tenantId)
        .select("invoice_id, amount, reversed_at, verification_status")
        .in("invoice_id", invoiceIds),
      scopedFrom(admin, "collection_follow_up", tenantId)
        .select("*")
        .in("invoice_id", invoiceIds)
        .order("created_at", { ascending: true }),
      scopedFrom(admin, "operational_file", tenantId).select("id, file_number, client_id").in("id", fileIds),
      assigneeIds.length
        ? scopedFrom(admin, "app_user", tenantId).select("id, name, email").in("id", assigneeIds)
        : Promise.resolve({ data: [] as Row[] }),
    ]);

  const fileRows = (files ?? []) as Row[];
  const clientIds = [...new Set(fileRows.map((f) => f.client_id as string).filter(Boolean))];
  const { data: clients } = clientIds.length
    ? await scopedFrom(admin, "client", tenantId).select("id, name").in("id", clientIds)
    : { data: [] as Row[] };

  const group = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      const l = m.get(k);
      if (l) l.push(r);
      else m.set(k, [r]);
    }
    return m;
  };

  const linesByInvoice = group((lines ?? []) as Row[], (l) => l.invoice_id as string);
  const paymentsByInvoice = group((payments ?? []) as Row[], (p) => p.invoice_id as string);
  const followUpsByInvoice = group((followUps ?? []) as Row[], (f) => f.invoice_id as string);
  const fileById = new Map(fileRows.map((f) => [f.id as string, f]));
  const clientById = new Map(((clients ?? []) as Row[]).map((c) => [c.id as string, c.name as string]));
  const userById = new Map(((users ?? []) as Row[]).map((u) => [u.id as string, u]));

  const now = Date.now();

  let rows: CollectionsRow[] = invoices.map((inv) => {
    const invoiceId = inv.id as string;
    const file = fileById.get(inv.file_id as string);

    const totals = invoiceTotals(
      (linesByInvoice.get(invoiceId) ?? []).map((l) => ({
        quantity: num(l.quantity),
        unitAmount: num(l.unit_amount),
        taxRate: num(l.tax_rate),
      })),
    );
    const pays = paymentsByInvoice.get(invoiceId) ?? [];
    // THE SAME sum that drives invoice.status. Not a verified-only figure — that
    // would disagree with the invoice and create a second ledger.
    const paid = paidAmount(pays.map((p) => ({ amount: num(p.amount), reversed: !!p.reversed_at })));
    const outstanding = Math.max(0, balanceDue(totals.total, paid));

    // Surfaced as a SIGNAL instead: chase Finance, don't silently change the number.
    const paymentAwaitingVerification = pays.some(
      (p) => !p.reversed_at && p.verification_status === "PENDING",
    );

    const dispute: DisputeView = {
      open: !!inv.disputed_at && !inv.dispute_resolved_at,
      category: str(inv.dispute_category),
      reason: str(inv.dispute_reason),
      openedAt: str(inv.disputed_at),
      resolvedAt: str(inv.dispute_resolved_at),
      resolution: str(inv.dispute_resolution),
    };

    const aging = evaluateAging({
      status: inv.status as string,
      dueDate: str(inv.due_date),
      total: totals.total,
      paid,
      disputed: dispute.open,
      today,
    });

    const fus: FollowUp[] = (followUpsByInvoice.get(invoiceId) ?? []).map((f) => ({
      id: f.id as string,
      channel: f.channel as string,
      outcome: f.outcome as string,
      note: str(f.note),
      promisedPaymentDate: str(f.promised_payment_date),
      promisedAmount: f.promised_amount === null || f.promised_amount === undefined ? null : num(f.promised_amount),
      nextFollowUpAt: str(f.next_follow_up_at),
      performedBy: str(f.performed_by),
      createdAt: f.created_at as string,
    }));

    const promise = derivePromise(fus, outstanding, today);
    const last = fus[fus.length - 1] ?? null;
    const hoursSinceLastFollowUp = last
      ? Math.max(0, Math.round((now - new Date(last.createdAt).getTime()) / 3_600_000))
      : null;

    const priority = evaluateCollectionsPriority({
      aging,
      promise,
      dispute,
      hoursSinceLastFollowUp,
      paymentAwaitingVerification,
      escalated: !!inv.escalated_at,
      processBlocked: false,
    });

    // A cheap, honest blocker list for the row. The AUTHORITATIVE evaluation is
    // lib/process/engine/closure.ts — this is a display hint, and says so.
    const closureBlockers: string[] = [];
    if (outstanding > 0) closureBlockers.push("balance_zero");
    if (dispute.open) closureBlockers.push("no_open_dispute");
    if (!inv.collections_completed_at) closureBlockers.push("collections_complete");

    const assigneeId = str(inv.collections_assignee_id);
    const assignee = assigneeId ? userById.get(assigneeId) : null;

    return {
      invoiceId,
      fileId: inv.file_id as string,
      fileNumber: (file?.file_number as string) ?? "—",
      invoiceNumber: str(inv.invoice_number),
      clientName: clientById.get((file?.client_id as string) ?? "") ?? "—",
      issueDate: str(inv.issue_date),
      dueDate: str(inv.due_date),
      total: totals.total,
      paid,
      outstanding,
      aging,
      assigneeId,
      assigneeName: str(assignee?.name) ?? str(assignee?.email),
      lastFollowUpAt: last?.createdAt ?? null,
      nextFollowUpAt: last?.nextFollowUpAt ?? null,
      promise,
      dispute,
      paymentAwaitingVerification,
      priority,
      collectionsCompleted: !!inv.collections_completed_at,
      closureBlockers,
    };
  });

  // Server-side filters on the derived state.
  const f = filters;
  if (f.bucket) rows = rows.filter((r) => r.aging.bucket === f.bucket);
  if (f.disputed) rows = rows.filter((r) => r.dispute.open);
  if (f.missedPromise) rows = rows.filter((r) => r.promise.status === "missed");
  if (f.promiseDue) rows = rows.filter((r) => r.promise.status === "active");
  if (f.noRecentFollowUp) rows = rows.filter((r) => r.lastFollowUpAt === null);
  if (f.pendingVerification) rows = rows.filter((r) => r.paymentAwaitingVerification);
  if (f.partiallyPaid) rows = rows.filter((r) => r.aging.partiallyPaid);
  if (f.fullyPaid) rows = rows.filter((r) => r.aging.fullyPaid);
  if (f.closureReady) rows = rows.filter((r) => r.closureBlockers.length === 0);
  if (typeof f.minBalance === "number") rows = rows.filter((r) => r.outstanding >= f.minBalance!);
  if (typeof f.maxBalance === "number") rows = rows.filter((r) => r.outstanding <= f.maxBalance!);
  if (f.search) {
    const s = f.search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.fileNumber.toLowerCase().includes(s) ||
        r.clientName.toLowerCase().includes(s) ||
        (r.invoiceNumber ?? "").toLowerCase().includes(s),
    );
  }

  rows.sort((a, b) => {
    if (b.priority.score !== a.priority.score) return b.priority.score - a.priority.score;
    return compareAging(a.aging, b.aging);
  });

  const total = rows.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, page, pageSize };
}
